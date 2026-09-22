<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\DocumentVersionResource;
use App\Models\Document;
use App\Models\DocumentVersion;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class DocumentVersionController extends Controller
{
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
     */
    public function store(Request $request, Document $document): DocumentVersionResource
    {
        $this->authorize('edit', $document);

        $validated = $request->validate([
            'name' => ['nullable', 'string', 'max:200'],
            'content_json' => ['required', 'array'],
            'content_html' => ['required', 'string'],
        ]);

        $version = $document->versions()->create([
            'name' => $validated['name'] ?? null,
            'content_json' => $validated['content_json'],
            'content_html' => $validated['content_html'],
            'user_id' => $request->user()->id,
        ]);

        return new DocumentVersionResource($version->load('user:id,name'));
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
