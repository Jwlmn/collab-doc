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
        Schema::create('document_mentions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('document_id')->constrained()->cascadeOnDelete();
            // 被提及者；提及发起人单独记录（同一文档多人提及各自成行）
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('mentioned_by_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();
            // 同一文档对同一人的编辑器提及只通知一次（pivot 即去重账本）
            $table->unique(['document_id', 'user_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('document_mentions');
    }
};
