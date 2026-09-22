<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DocumentLastRead extends Model
{
    /** 无更新时间需求，仅 created_at */
    public const UPDATED_AT = null;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'user_id',
        'last_comment_id',
    ];

    /**
     * 所属文档。
     */
    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    /**
     * 阅读者。
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
