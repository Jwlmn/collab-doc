<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DocumentPin extends Model
{
    /**
     * @var list<string>
     */
    protected $fillable = [
        'user_id',
        'document_id',
    ];

    /**
     * 置顶发起人。
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * 被置顶的文档。
     */
    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }
}
