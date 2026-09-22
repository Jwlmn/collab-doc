<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->text('search_text')->nullable();
        });

        if (DB::getDriverName() === 'pgsql') {
            // pg_trgm 三元组索引加速 ILIKE 子串检索（扩展已在初始化脚本启用）
            DB::statement(
                'CREATE INDEX documents_title_trgm_idx ON documents USING gin (title gin_trgm_ops)'
            );
            DB::statement(
                'CREATE INDEX documents_search_text_trgm_idx ON documents USING gin (search_text gin_trgm_ops)'
            );
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS documents_title_trgm_idx');
            DB::statement('DROP INDEX IF EXISTS documents_search_text_trgm_idx');
        }

        Schema::table('documents', function (Blueprint $table) {
            $table->dropColumn('search_text');
        });
    }
};
