<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            // md = 富文本文档；excel = 电子表格文档（存量数据回填 md）
            $table->string('type', 20)->default('md')->after('title');
            $table->index(['type', 'updated_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropIndex(['type', 'updated_at']);
            $table->dropColumn('type');
        });
    }
};
