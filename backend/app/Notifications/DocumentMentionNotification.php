<?php

namespace App\Notifications;

use App\Models\Document;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

/**
 * 编辑器正文内 @提及 的站内通知（无评论锚点，跳转直接进文档）。
 */
class DocumentMentionNotification extends Notification
{
    use Queueable;

    public function __construct(
        public readonly Document $document,
        public readonly User $actor,
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
        return [
            'kind' => 'mention',
            'document_id' => $this->document->id,
            'doc_type' => $this->document->type ?? 'md',
            'document_title' => $this->document->title,
            // 无 comment_id：通知铃点击直接进文档（而非定位到评论）
            'actor_id' => $this->actor->id,
            'actor_name' => $this->actor->name,
        ];
    }
}
