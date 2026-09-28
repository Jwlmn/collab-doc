<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            // pg_trgm 三元组索引加速评论内容的 ILIKE 子串检索（扩展已在初始化脚本启用）
            DB::statement(
                'CREATE INDEX comments_content_trgm_idx ON comments USING gin (content gin_trgm_ops)'
            );
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS comments_content_trgm_idx');
        }
    }
};
