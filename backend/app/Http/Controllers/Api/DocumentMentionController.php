<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Document;
use App\Models\DocumentMention;
use App\Models\User;
use App\Notifications\DocumentMentionNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DocumentMentionController extends Controller
{
    /**
     * 编辑器正文内出现新的 @提及 时由前端上报：
     * 对同一文档首次被提及的用户发一次站内通知，重复上报幂等。
     */
    public function store(Request $request, Document $document): JsonResponse
    {
        $this->authorize('comment', $document);

        $validated = $request->validate([
            'user_ids' => ['required', 'array', 'min:1', 'max:20'],
            'user_ids.*' => ['integer', 'exists:users,id'],
        ]);

        $actor = $request->user();
        $notified = [];

        foreach (array_unique(array_map('intval', $validated['user_ids'])) as $userId) {
            if ($userId === $actor->id) {
                continue;
            }

            $mention = DocumentMention::firstOrCreate([
                'document_id' => $document->id,
                'user_id' => $userId,
            ], [
                'mentioned_by_id' => $actor->id,
            ]);

            if ($mention->wasRecentlyCreated) {
                /** @var User $mentioned */
                $mentioned = User::query()->findOrFail($userId);
                $mentioned->notify(new DocumentMentionNotification($document, $actor));
                $notified[] = $userId;
            }
        }

        return response()->json(['data' => ['notified' => $notified]]);
    }
}
