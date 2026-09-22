<?php

namespace App\Notifications;

use App\Models\Comment;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

class MentionNotification extends Notification
{
    use Queueable;

    public function __construct(
        public readonly Comment $comment,
    ) {}

    /**
     * 仅站内通知（database）。
     *
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return ['database'];
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(object $notifiable): array
    {
        return $this->toDatabase($notifiable);
    }

    /**
     * @return array<string, mixed>
     */
    public function toDatabase(object $notifiable): array
    {
        $document = $this->comment->document;

        return [
            'kind' => 'mention',
            'document_id' => $document?->id,
            'doc_type' => $document?->type ?? 'md',
            'document_title' => $document?->title ?? '',
            'comment_id' => $this->comment->id,
            'actor_id' => $this->comment->user_id,
            'actor_name' => $this->comment->user?->name ?? '有人',
        ];
    }
}
