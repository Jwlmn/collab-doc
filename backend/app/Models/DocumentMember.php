<?php

namespace App\Models;

use Database\Factories\DocumentMemberFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DocumentMember extends Model
{
    /** @use HasFactory<DocumentMemberFactory> */
    use HasFactory;

    public const ROLE_VIEWER = 'viewer';

    public const ROLE_EDITOR = 'editor';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'user_id',
        'role',
    ];

    /**
     * 所属文档。
     */
    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    /**
     * 成员用户。
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * 合法角色列表。
     *
     * @return list<string>
     */
    public static function roles(): array
    {
        return [self::ROLE_VIEWER, self::ROLE_EDITOR];
    }
}
