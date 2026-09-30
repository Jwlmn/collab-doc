<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CommentResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'document_id' => $this->document_id,
            // null = 根评论；非空 = 被回复评论 id（真实线程层级，前端决定展示深度）
            'parent_id' => $this->parent_id,
            // 仅根评论有意义：非空即线程已解决
            'resolved_at' => $this->resolved_at?->toIso8601String(),
            'content' => $this->content,
            'mentions' => $this->mentions ?? [],
            'user' => [
                'id' => $this->user?->id,
                'name' => $this->user?->name,
            ],
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
