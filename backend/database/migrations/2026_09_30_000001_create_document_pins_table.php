<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 文档置顶（按用户独立）：A 置顶共享给自己的文档不影响 B 的列表。
 * 文档删除（含彻底删除）随外键级联清掉置顶记录；软删除恢复后置顶仍在。
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_pins', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('document_id')->constrained()->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['user_id', 'document_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_pins');
    }
};
