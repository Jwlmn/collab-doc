<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 协作文档状态（Y.js 二进制快照），由 HocusPocus 协作服务器读写。
 *
 * 该表归服务器所有（server/src/index.ts 的 ensureSchema 同款 DDL），
 * 此迁移仅为保证 migrate:fresh 后表仍存在——此前发生过 fresh 清掉本表、
 * 而运行中的协作服务器不再重建，导致所有客户端永远「同步中」的事故。
 * 两边均为 IF NOT EXISTS 语义，可共存。
 */
return new class extends Migration
{
    public function up(): void
    {
        // 与 server 的 ensureSchema 并存：已存在则跳过（server 可能先建了）
        if (Schema::hasTable('document_states')) {
            return;
        }

        Schema::create('document_states', function (Blueprint $table) {
            $table->text('name')->primary();
            $table->binary('state');
            // useCurrent 跨驱动可用（pgsql/sqlite 均编译为 CURRENT_TIMESTAMP）；
            // server 写入时显式带 updated_at，此默认值仅作兜底
            $table->timestampTz('updated_at')->useCurrent();
        });
    }

    public function down(): void
    {
        // 不随 migrate:rollback 删除：该表语义上归协作服务器所有
    }
};
