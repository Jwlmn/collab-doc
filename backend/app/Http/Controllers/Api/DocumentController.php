<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\DocumentResource;
use App\Models\Document;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

class DocumentController extends Controller
{
    /**
     * 当前用户的文档列表（自有 + 共享给我）。
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $user = $request->user();

        $documents = Document::query()
            ->with(['user:id,name', 'members.user:id,name'])
            ->where(function ($query) use ($user) {
                $query
                    ->where('user_id', $user->id)
                    ->orWhereHas('members', fn ($memberQuery) => $memberQuery->where('user_id', $user->id));
            })
            ->orderByDesc('updated_at')
            ->get();

        return DocumentResource::collection($documents);
    }

    /**
     * 搜索文档（标题 + 正文纯文本，仅限有权访问的文档）。
     */
    public function search(Request $request)
    {
        $validated = $request->validate([
            'q' => ['required', 'string', 'max:200'],
        ]);

        $user = $request->user();
        $query = trim($validated['q']);

        if ($query === '') {
            return response()->json(['message' => '搜索词不能为空。', 'data' => []], 422);
        }

        $escaped = addcslashes($query, '\\%_');
        $operator = DB::getDriverName() === 'pgsql' ? 'ILIKE' : 'LIKE';
        $pattern = '%'.$escaped.'%';

        $documents = Document::query()
            ->with(['user:id,name', 'members.user:id,name'])
            ->where(function ($accessible) use ($user) {
                $accessible
                    ->where('user_id', $user->id)
                    ->orWhereHas('members', fn ($member) => $member->where('user_id', $user->id));
            })
            ->where(function ($match) use ($operator, $pattern) {
                $match
                    ->whereRaw("title {$operator} ? ESCAPE '\\'", [$pattern])
                    ->orWhereRaw(
                        "COALESCE(search_text, '') {$operator} ? ESCAPE '\\'",
                        [$pattern],
                    );
            })
            ->orderByDesc('updated_at')
            ->limit(20)
            ->get();

        $data = $documents->map(function (Document $document) use ($request, $query) {
            $payload = (new DocumentResource($document))->toArray($request);

            $payload['snippet'] = $this->buildSnippet(
                $document->search_text,
                $document->title,
                $query,
            );

            return $payload;
        });

        return response()->json(['data' => $data]);
    }

    /**
     * 提取包含搜索词的上下文片段（优先正文，其次标题）。
     */
    private function buildSnippet(?string $searchText, string $title, string $query): ?string
    {
        foreach ([$searchText, $title] as $source) {
            if ($source === null || $source === '') {
                continue;
            }

            $position = mb_stripos($source, $query);

            if ($position === false) {
                continue;
            }

            $start = max(0, $position - 40);
            $slice = mb_substr($source, $start, 100);
            $prefix = $start > 0 ? '…' : '';
            $suffix = $start + 100 < mb_strlen($source) ? '…' : '';

            return $prefix.str_replace(["\n", "\r"], ' ', $slice).$suffix;
        }

        return null;
    }

    /**
     * 新建文档。
     */
    public function store(Request $request): DocumentResource
    {
        $this->authorize('create', Document::class);

        $validated = $request->validate([
            'title' => ['nullable', 'string', 'max:200'],
            'type' => ['nullable', Rule::in(Document::types())],
        ]);

        $document = $request->user()->documents()->create([
            'title' => $validated['title'] ?? '未命名文档',
            'type' => $validated['type'] ?? Document::TYPE_MD,
        ]);

        return new DocumentResource(
            $document->load(['user:id,name'])
        );
    }

    /**
     * 文档详情。
     */
    public function show(Request $request, Document $document): DocumentResource
    {
        $this->authorize('view', $document);

        $document->load(['user:id,name', 'members.user:id,name']);

        return new DocumentResource($document);
    }

    /**
     * 更新文档（当前仅标题，仅所有者）。
     */
    public function update(Request $request, Document $document): DocumentResource
    {
        $this->authorize('update', $document);

        $validated = $request->validate([
            'title' => ['required', 'string', 'max:200'],
        ]);

        $document->update($validated);

        return new DocumentResource($document->load(['user:id,name']));
    }

    /**
     * 删除文档（进入回收站，软删除）。
     */
    public function destroy(Document $document): Response
    {
        $this->authorize('delete', $document);

        $document->delete();

        return response()->noContent();
    }

    /**
     * 回收站列表（仅自己删除的文档）。
     */
    public function trashed(Request $request): AnonymousResourceCollection
    {
        $documents = $request->user()
            ->documents()
            ->onlyTrashed()
            ->with(['user:id,name', 'members' => fn ($query) => $query->where('user_id', $request->user()->id)])
            ->orderByDesc('deleted_at')
            ->get();

        return DocumentResource::collection($documents);
    }

    /**
     * 从回收站恢复文档。
     */
    public function restore(Request $request, int $document): DocumentResource
    {
        /** @var Document|null $doc */
        $doc = Document::onlyTrashed()->find($document);

        if ($doc === null || $doc->user_id !== $request->user()->id) {
            abort(404);
        }

        $doc->restore();

        return new DocumentResource($doc->load(['user:id,name']));
    }

    /**
     * 彻底删除文档（版本/评论/成员由外键级联清空，协同状态由协作表清理）。
     */
    public function forceDestroy(Request $request, int $document): Response
    {
        /** @var Document|null $doc */
        $doc = Document::onlyTrashed()->find($document);

        if ($doc === null || $doc->user_id !== $request->user()->id) {
            abort(404);
        }

        $stateName = "doc-{$doc->id}";
        $doc->forceDelete();

        // document_states 由协作服务器建表（不在 Laravel 迁移中），彻底删除时一并清掉
        if (Schema::hasTable('document_states')) {
            DB::table('document_states')->where('name', $stateName)->delete();
        }

        return response()->noContent();
    }
}
