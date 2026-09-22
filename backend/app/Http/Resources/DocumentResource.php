<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DocumentResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $viewerId = $request->user()?->id;

        $membership = $viewerId === null
            ? null
            : $this->members->firstWhere('user_id', $viewerId);

        return [
            'id' => $this->id,
            'user_id' => $this->user_id,
            'title' => $this->title,
            'type' => $this->type ?? 'md',
            'role' => $this->user_id === $viewerId
                ? 'owner'
                : $membership?->role,
            'owner' => [
                'id' => $this->user?->id,
                'name' => $this->user?->name,
            ],
            // 成员摘要（列表页头像叠堆 / 分享入口可见性判断）
            'members' => $this->members
                ->map(fn ($member) => [
                    'id' => $member->user?->id,
                    'name' => $member->user?->name,
                    'role' => $member->role,
                ])
                ->values(),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
