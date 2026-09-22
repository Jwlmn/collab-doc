<?php

namespace Tests\Feature;

use App\Models\Comment;
use App\Models\Document;
use App\Models\DocumentLastRead;
use App\Models\DocumentMember;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CommentUnreadTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_cannot_check_unread(): void
    {
        $document = Document::factory()->create();

        $this->getJson("/api/documents/{$document->id}/comments/unread")->assertUnauthorized();
        $this->postJson("/api/documents/{$document->id}/comments/read")->assertUnauthorized();
    }

    public function test_unread_counts_comments_beyond_watermark(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        Comment::factory()->count(3)->for($document)->for($user)->create();

        // 未读记录：全部未读
        $this->actingAs($user)
            ->getJson("/api/documents/{$document->id}/comments/unread")
            ->assertOk()
            ->assertJsonPath('data.count', 3);

        // 标记已读 → 归零
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments/read")
            ->assertOk()
            ->assertJsonPath('data.last_comment_id', fn ($id) => $id > 0);

        $this->actingAs($user)
            ->getJson("/api/documents/{$document->id}/comments/unread")
            ->assertOk()
            ->assertJsonPath('data.count', 0);

        // 新评论 → 未读 +1
        Comment::factory()->for($document)->for($user)->create();

        $this->actingAs($user)
            ->getJson("/api/documents/{$document->id}/comments/unread")
            ->assertOk()
            ->assertJsonPath('data.count', 1);
    }

    public function test_mark_read_never_goes_backwards(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $first = Comment::factory()->for($document)->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments/read")
            ->assertOk();

        // 水位 = 第一条 id；再标记一次（无新评论）不回退
        $record = DocumentLastRead::where('document_id', $document->id)
            ->where('user_id', $user->id)
            ->first();
        $this->assertSame($first->id, $record->last_comment_id);

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments/read")
            ->assertOk()
            ->assertJsonPath('data.last_comment_id', $first->id);
    }

    public function test_unread_is_per_user(): void
    {
        $owner = User::factory()->create();
        $member = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        DocumentMember::factory()->for($document)->for($member)->create(['role' => 'editor']);
        Comment::factory()->count(2)->for($document)->for($owner)->create();

        // 所有者标记已读
        $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/comments/read")
            ->assertOk();

        $this->actingAs($owner)
            ->getJson("/api/documents/{$document->id}/comments/unread")
            ->assertJsonPath('data.count', 0);

        // 成员仍有未读
        $this->actingAs($member)
            ->getJson("/api/documents/{$document->id}/comments/unread")
            ->assertJsonPath('data.count', 2);
    }

    public function test_stranger_cannot_check_unread(): void
    {
        $owner = User::factory()->create();
        $stranger = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $this->actingAs($stranger)
            ->getJson("/api/documents/{$document->id}/comments/unread")
            ->assertForbidden();

        $this->actingAs($stranger)
            ->postJson("/api/documents/{$document->id}/comments/read")
            ->assertForbidden();
    }
}
