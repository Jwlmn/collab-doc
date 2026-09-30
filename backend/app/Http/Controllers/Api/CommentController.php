<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\CommentResource;
use App\Models\Comment;
use App\Models\Document;
use App\Models\User;
use App\Notifications\MentionNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

class CommentController extends Controller
{
    /**
     * 文档的评论列表（按时间正序）。
     */
    public function index(Request $request, Document $document): AnonymousResourceCollection
    {
        $this->authorize('view', $document);

        $comments = $document->comments()
            ->with('user:id,name')
            ->orderBy('id')
            ->get();

        return CommentResource::collection($comments);
    }

    /**
     * 发表评论或回复（支持 @[姓名](user:ID) 提及标记）。
     *
     * parent_id 指向根评论即为回复；对回复再回复会被压平挂到同一根下（只保留一层）。
     */
    public function store(Request $request, Document $document): CommentResource
    {
        $this->authorize('comment', $document);

        $validated = $request->validate([
            'content' => ['required', 'string', 'max:2000'],
            'parent_id' => [
                'nullable',
                'integer',
                Rule::exists('comments', 'id')->where('document_id', $document->id),
            ],
        ]);

        $parentId = $validated['parent_id'] ?? null;
        if ($parentId !== null) {
            /** @var Comment $parent */
            $parent = Comment::query()->findOrFail($parentId);
            // 一层扁平：对回复再回复挂回同一根
            $parentId = $parent->parent_id ?? $parent->id;
        }

        $mentionedIds = Comment::parseMentionIds($validated['content']);
        $existingIds = User::whereIn('id', $mentionedIds)->pluck('id')->all();

        $comment = $document->comments()->create([
            'content' => $validated['content'],
            'mentions' => $existingIds === [] ? null : $existingIds,
            'user_id' => $request->user()->id,
            'parent_id' => $parentId,
        ]);

        // 站内通知：被 @ 的用户（不含评论者自己）
        $mentionedUsers = User::whereIn('id', $existingIds)
            ->where('id', '!=', $request->user()->id)
            ->get();
        foreach ($mentionedUsers as $mentioned) {
            $mentioned->notify(new MentionNotification($comment));
        }

        return new CommentResource($comment->load('user:id,name'));
    }

    /**
     * 删除评论（作者或文档所有者）。
     */
    public function destroy(Document $document, Comment $comment): Response
    {
        $this->authorize('view', $document);
        $this->authorize('delete', $comment);

        $comment->delete();

        return response()->noContent();
    }

    /**
     * 标记线程已解决 / 重新打开（仅根评论可操作）。
     */
    public function resolve(Request $request, Document $document, Comment $comment): JsonResponse
    {
        $this->authorize('comment', $document);

        abort_if($comment->document_id !== $document->id, 404);

        $validated = $request->validate([
            'resolved' => ['required', 'boolean'],
        ]);

        if ($comment->parent_id !== null) {
            abort(422, '回复不能单独标记解决，请操作其根评论。');
        }

        $comment->update([
            'resolved_at' => $validated['resolved'] ? now() : null,
        ]);

        return (new CommentResource($comment->load('user:id,name')))->response();
    }

    /**
     * 当前用户在该文档的未读评论数 + 全文档未解决线程数（顶栏角标合并展示）。
     */
    public function unread(Request $request, Document $document): JsonResponse
    {
        $this->authorize('view', $document);

        $lastReadId = $document->lastReads()
            ->where('user_id', $request->user()->id)
            ->value('last_comment_id') ?? 0;

        $count = $document->comments()->where('id', '>', $lastReadId)->count();

        $unresolved = $document->comments()
            ->whereNull('parent_id')
            ->whereNull('resolved_at')
            ->count();

        return response()->json(['data' => ['count' => $count, 'unresolved' => $unresolved]]);
    }

    /**
     * 将文档评论标记为已读（推进到当前最大评论 id，只进不退）。
     */
    public function markRead(Request $request, Document $document): JsonResponse
    {
        $this->authorize('view', $document);

        $maxId = (int) ($document->comments()->max('id') ?? 0);

        $record = $document->lastReads()->firstOrCreate([
            'user_id' => $request->user()->id,
        ], [
            'last_comment_id' => $maxId,
        ]);

        if ($maxId > $record->last_comment_id) {
            $record->update(['last_comment_id' => $maxId]);
        }

        return response()->json(['data' => ['last_comment_id' => $record->last_comment_id]]);
    }
}
