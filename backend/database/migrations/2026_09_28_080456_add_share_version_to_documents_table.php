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
            // 公开分享令牌的撤销版本号：+1 即让该文档所有在外分享链接同时失效。
            // 无状态 HMAC 无法逐条撤销，用文档级版本号实现「一键撤销全部」。
            $table->unsignedInteger('share_version')->default(0);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropColumn('share_version');
        });
    }
};
