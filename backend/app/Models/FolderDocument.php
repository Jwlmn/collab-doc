<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 文档归入文件夹的归属行（per-user 语义由 folder.user_id 承载）。
 */
class FolderDocument extends Model
{
    /**
     * @var list<string>
     */
    protected $fillable = [
        'folder_id',
        'document_id',
    ];

    /**
     * 所属文件夹。
     */
    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class);
    }

    /**
     * 被归档的文档。
     */
    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }
}
