<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\DocumentVersionResource;
use App\Models\Document;
use App\Models\DocumentVersion;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class DocumentVersionController extends Controller
{
    /** 自动快照最短间隔（秒）：同一文档短时间内反复触发只保留一次 */
    private const AUTO_MIN_INTERVAL = 300;

    /** 每个文档保留的自动快照条数上限（超出的最旧者被淘汰） */
    private const AUTO_KEEP = 20;

    /**
     * 文档的版本列表（仅元数据；content 字段可能很大，按需经 show 获取）。
     */
    public function index(Document $document): JsonResponse
    {
        $this->authorize('view', $document);

        $versions = $document->versions()
            ->with('user:id,name')
            ->orderByDesc('id')
            ->get();

        return response()->json([
            'data' => $versions->map(fn (DocumentVersion $version) => [
                'id' => $version->id,
                'document_id' => $version->document_id,
                'name' => $version->name,
                'kind' => $version->kind ?? 'manual',
                'user' => [
                    'id' => $version->user?->id,
                    'name' => $version->user?->name,
                ],
                'created_at' => $version->created_at?->toIso8601String(),
            ]),
        ]);
    }

    /**
     * 保存新版本快照。
     *
     * 自动快照（kind=auto）会做两层收敛：内容完全相同直接复用既有版本；
     * 距上一条自动快照不足 AUTO_MIN_INTERVAL 秒同样复用。成功创建后按
     * AUTO_KEEP 淘汰最旧的自动快照，避免版本列表被自动条目淹没。
     */
    public function store(Request $request, Document $document): DocumentVersionResource
    {
        $this->authorize('edit', $document);

        $validated = $request->validate([
            'name' => ['nullable', 'string', 'max:200'],
            'kind' => ['nullable', Rule::in(['manual', 'auto'])],
            'content_json' => ['required', 'array'],
            'content_html' => ['required', 'string'],
        ]);

        $kind = $validated['kind'] ?? 'manual';
        // 哈希由服务端计算：客户端传什么内容，就按什么内容判重
        $hash = hash('sha256', json_encode($validated['content_json'], JSON_UNESCAPED_UNICODE));

        return DB::transaction(function () use ($document, $request, $validated, $kind, $hash) {
            $latest = $document->versions()->lockForUpdate()->orderByDesc('id')->first();

            if ($kind === 'auto' && $latest !== null) {
                // 内容未变 → 复用既有版本，不制造重复条目
                if ($latest->content_hash === $hash) {
                    return new DocumentVersionResource($latest->load('user:id,name'));
                }
                // 距上一条自动快照太密 → 同样复用（手动保存不受此限）
                if ($latest->kind === 'auto' && $latest->created_at !== null
                    && $latest->created_at->gt(now()->subSeconds(self::AUTO_MIN_INTERVAL))) {
                    return new DocumentVersionResource($latest->load('user:id,name'));
                }
            } elseif ($kind === 'manual' && $latest !== null
                && $latest->content_hash === $hash
                && $latest->name === ($validated['name'] ?? null)) {
                // 手动保存但内容与名称都未变（典型是连点两次）→ 复用，不制造重复条目
                // 名称不同仍允许创建，方便同一内容存成「初稿」「终稿」
                return new DocumentVersionResource($latest->load('user:id,name'));
            }

            $version = $document->versions()->create([
                'name' => $validated['name'] ?? null,
                'kind' => $kind,
                'content_json' => $validated['content_json'],
                'content_html' => $validated['content_html'],
                'content_hash' => $hash,
                'user_id' => $request->user()->id,
            ]);

            if ($kind === 'auto') {
                $this->pruneAutoVersions($document);
            }

            return new DocumentVersionResource($version->load('user:id,name'));
        });
    }

    /**
     * 每个文档只保留最新 AUTO_KEEP 条自动快照。
     */
    private function pruneAutoVersions(Document $document): void
    {
        $staleIds = $document->versions()
            ->where('kind', 'auto')
            ->orderByDesc('id')
            ->skip(self::AUTO_KEEP)
            ->take(1000)
            ->pluck('id');

        if ($staleIds->isNotEmpty()) {
            DocumentVersion::whereIn('id', $staleIds)->delete();
        }
    }

    /**
     * 版本详情（预览与恢复均使用此接口获取内容）。
     */
    public function show(Document $document, DocumentVersion $version): DocumentVersionResource
    {
        $this->authorize('view', $document);

        return new DocumentVersionResource($version->load('user:id,name'));
    }

    /**
     * 删除版本。
     */
    public function destroy(Document $document, DocumentVersion $version): Response
    {
        $this->authorize('edit', $document);

        $version->delete();

        return response()->noContent();
    }
}
