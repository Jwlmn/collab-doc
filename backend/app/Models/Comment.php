<?php

namespace App\Models;

use Database\Factories\CommentFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Comment extends Model
{
    /** @use HasFactory<CommentFactory> */
    use HasFactory;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'document_id',
        'user_id',
        'parent_id',
        'content',
        'mentions',
        'resolved_at',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'mentions' => 'array',
            'resolved_at' => 'datetime',
        ];
    }

    /**
     * 所属文档。
     */
    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    /**
     * 评论作者。
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * 所属根评论（null = 自身就是根）。
     */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    /**
     * 直接回复该评论的评论（可多层；展示层级由前端封顶）。
     *
     * @return HasMany<Comment, $this>
     */
    public function replies(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    /**
     * 从评论内容中解析被 @ 的用户 ID 列表（@[姓名](user:ID) 标记）。
     *
     * @return list<int>
     */
    public static function parseMentionIds(string $content): array
    {
        preg_match_all('/@\[[^\]]*\]\(user:(\d+)\)/u', $content, $matches);

        $ids = array_map('intval', $matches[1] ?? []);

        return array_values(array_unique($ids));
    }
}
