<?php

namespace App\Policies;

use App\Models\Document;
use App\Models\User;

class DocumentPolicy
{
    /**
     * 是否可以创建文档。
     */
    public function create(User $user): bool
    {
        return true;
    }

    /**
     * 是否可以查看文档（所有者或任意成员）。
     */
    public function view(User $user, Document $document): bool
    {
        return $this->roleFor($user, $document) !== null;
    }

    /**
     * 是否可以编辑文档内容 / 保存与删除版本（所有者或编辑成员）。
     */
    public function edit(User $user, Document $document): bool
    {
        return in_array($this->roleFor($user, $document), ['owner', 'editor'], true);
    }

    /**
     * 是否可以发表评论（所有者或任意成员）。
     */
    public function comment(User $user, Document $document): bool
    {
        return $this->roleFor($user, $document) !== null;
    }

    /**
     * 是否可以更新文档元数据（重命名，仅所有者）。
     */
    public function update(User $user, Document $document): bool
    {
        return $user->id === $document->user_id;
    }

    /**
     * 是否可以删除文档（仅所有者）。
     */
    public function delete(User $user, Document $document): bool
    {
        return $user->id === $document->user_id;
    }

    /**
     * 是否可以管理成员（仅所有者）。
     */
    public function manage(User $user, Document $document): bool
    {
        return $user->id === $document->user_id;
    }

    /**
     * 解析用户在文档上的角色。
     *
     * @return 'owner'|'editor'|'viewer'|null
     */
    private function roleFor(User $user, Document $document): ?string
    {
        if ($user->id === $document->user_id) {
            return 'owner';
        }

        $member = $document->relationLoaded('members')
            ? $document->members->firstWhere('user_id', $user->id)
            : $document->members()->where('user_id', $user->id)->first();

        return $member?->role;
    }
}
