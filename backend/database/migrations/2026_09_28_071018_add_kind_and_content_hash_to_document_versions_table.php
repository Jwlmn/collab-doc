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
        Schema::table('document_versions', function (Blueprint $table) {
            // 来源：manual = 手动保存；auto = 编辑器静默自动快照；restore = 恢复前的安全备份
            $table->string('kind', 16)->default('manual');
            // sha256(content_json)，由服务端计算（不信客户端），用于内容去重
            $table->char('content_hash', 64)->nullable();
            $table->index(['document_id', 'kind', 'id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('document_versions', function (Blueprint $table) {
            $table->dropIndex(['document_id', 'kind', 'id']);
            $table->dropColumn(['kind', 'content_hash']);
        });
    }
};
