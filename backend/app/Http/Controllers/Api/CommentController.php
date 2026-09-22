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
     * 发表评论（支持 @[姓名](user:ID) 提及标记）。
     */
    public function store(Request $request, Document $document): CommentResource
    {
        $this->authorize('comment', $document);

        $validated = $request->validate([
            'content' => ['required', 'string', 'max:2000'],
        ]);

        $mentionedIds = Comment::parseMentionIds($validated['content']);
        $existingIds = User::whereIn('id', $mentionedIds)->pluck('id')->all();

        $comment = $document->comments()->create([
            'content' => $validated['content'],
            'mentions' => $existingIds === [] ? null : $existingIds,
            'user_id' => $request->user()->id,
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
     * 当前用户在该文档的未读评论数。
     */
    public function unread(Request $request, Document $document): JsonResponse
    {
        $this->authorize('view', $document);

        $lastReadId = $document->lastReads()
            ->where('user_id', $request->user()->id)
            ->value('last_comment_id') ?? 0;

        $count = $document->comments()->where('id', '>', $lastReadId)->count();

        return response()->json(['data' => ['count' => $count]]);
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
