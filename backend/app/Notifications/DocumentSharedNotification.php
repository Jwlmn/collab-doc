<?php

namespace App\Notifications;

use App\Models\Document;
use App\Models\DocumentMember;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

class DocumentSharedNotification extends Notification
{
    use Queueable;

    public function __construct(
        public readonly Document $document,
        public readonly DocumentMember $membership,
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
            'kind' => 'shared',
            'document_id' => $this->document->id,
            'doc_type' => $this->document->type ?? 'md',
            'document_title' => $this->document->title,
            'actor_id' => $this->document->user_id,
            'actor_name' => $this->document->user?->name ?? '有人',
            'role' => $this->membership->role,
        ];
    }
}
