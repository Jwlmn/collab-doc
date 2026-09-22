<?php

namespace App\Models;

use Database\Factories\CommentFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
        'content',
        'mentions',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'mentions' => 'array',
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
