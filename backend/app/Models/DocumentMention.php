<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 编辑器内 @提及 的去重账本：同一文档对同一人只通知一次。
 */
class DocumentMention extends Model
{
    /**
     * @var list<string>
     */
    protected $fillable = [
        'document_id',
        'user_id',
        'mentioned_by_id',
    ];

    /**
     * 所属文档。
     */
    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    /**
     * 被提及的用户。
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * 提及发起人。
     */
    public function mentionedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'mentioned_by_id');
    }
}
