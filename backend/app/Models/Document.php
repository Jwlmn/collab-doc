<?php

namespace App\Models;

use Database\Factories\DocumentFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Document extends Model
{
    /** @use HasFactory<DocumentFactory> */
    use HasFactory, SoftDeletes;

    public const TYPE_MD = 'md';

    public const TYPE_EXCEL = 'excel';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'title',
        'type',
        'search_text',
    ];

    /**
     * 合法文档类型。
     *
     * @return list<string>
     */
    public static function types(): array
    {
        return [self::TYPE_MD, self::TYPE_EXCEL];
    }

    /**
     * 文档所有者。
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * 文档版本历史。
     *
     * @return HasMany<DocumentVersion, $this>
     */
    public function versions(): HasMany
    {
        return $this->hasMany(DocumentVersion::class);
    }

    /**
     * 文档评论。
     *
     * @return HasMany<Comment, $this>
     */
    public function comments(): HasMany
    {
        return $this->hasMany(Comment::class);
    }

    /**
     * 文档共享成员（不含所有者）。
     *
     * @return HasMany<DocumentMember, $this>
     */
    public function members(): HasMany
    {
        return $this->hasMany(DocumentMember::class);
    }

    /**
     * 各用户的评论已读水位。
     *
     * @return HasMany<DocumentLastRead, $this>
     */
    public function lastReads(): HasMany
    {
        return $this->hasMany(DocumentLastRead::class);
    }
}
