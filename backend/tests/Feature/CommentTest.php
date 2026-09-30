<?php

namespace Tests\Feature;

use App\Models\Comment;
use App\Models\Document;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CommentTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_cannot_access_comments(): void
    {
        $document = Document::factory()->create();

        $this->getJson("/api/documents/{$document->id}/comments")->assertUnauthorized();
        $this->postJson("/api/documents/{$document->id}/comments", ['content' => '你好'])->assertUnauthorized();
    }

    public function test_owner_can_list_comments_chronologically(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $first = Comment::factory()->for($document)->for($user)->create(['content' => '第一条']);
        $second = Comment::factory()->for($document)->for($user)->create(['content' => '第二条']);

        $this->actingAs($user)
            ->getJson("/api/documents/{$document->id}/comments")
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.id', $first->id)
            ->assertJsonPath('data.1.id', $second->id);
    }

    public function test_owner_can_post_comment(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments", ['content' => '请复核这一段'])
            ->assertCreated()
            ->assertJsonPath('data.content', '请复核这一段')
            ->assertJsonPath('data.user.name', $user->name);

        $this->assertDatabaseHas('comments', [
            'document_id' => $document->id,
            'user_id' => $user->id,
            'content' => '请复核这一段',
        ]);
    }

    public function test_comment_parses_and_stores_mention_ids(): void
    {
        $user = User::factory()->create();
        $mentioned = User::factory()->create(['name' => '李四']);
        $document = Document::factory()->for($user)->create();

        $content = "@[李四](user:{$mentioned->id}) 看一下这里的表述";

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments", ['content' => $content])
            ->assertCreated()
            ->assertJsonPath('data.content', $content)
            ->assertJsonPath('data.mentions.0', $mentioned->id);
    }

    public function test_mention_of_nonexistent_user_is_dropped(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments", [
                'content' => '@[幽灵](user:999999) 你好',
            ])
            ->assertCreated()
            ->assertJsonPath('data.mentions', []);
    }

    public function test_comment_content_is_required_and_bounded(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments", ['content' => ''])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('content');

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments", ['content' => str_repeat('字', 2001)])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('content');
    }

    public function test_author_can_delete_own_comment(): void
    {
        $author = User::factory()->create();
        $document = Document::factory()->for($author)->create();
        $comment = Comment::factory()->for($document)->for($author)->create();

        $this->actingAs($author)
            ->deleteJson("/api/documents/{$document->id}/comments/{$comment->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('comments', ['id' => $comment->id]);
    }

    public function test_document_owner_can_delete_any_comment(): void
    {
        $owner = User::factory()->create();
        $author = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $comment = Comment::factory()->for($document)->for($author)->create();

        $this->actingAs($owner)
            ->deleteJson("/api/documents/{$document->id}/comments/{$comment->id}")
            ->assertNoContent();
    }

    public function test_unrelated_user_cannot_delete_comment(): void
    {
        $owner = User::factory()->create();
        $author = User::factory()->create();
        $stranger = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $comment = Comment::factory()->for($document)->for($author)->create();

        $this->actingAs($stranger)
            ->deleteJson("/api/documents/{$document->id}/comments/{$comment->id}")
            ->assertForbidden();

        $this->assertDatabaseHas('comments', ['id' => $comment->id]);
    }

    public function test_non_owner_cannot_list_or_post_comments(): void
    {
        $owner = User::factory()->create();
        $stranger = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $this->actingAs($stranger)
            ->getJson("/api/documents/{$document->id}/comments")
            ->assertForbidden();

        $this->actingAs($stranger)
            ->postJson("/api/documents/{$document->id}/comments", ['content' => '偷看'])
            ->assertForbidden();
    }

    public function test_comment_scoped_to_its_document(): void
    {
        $user = User::factory()->create();
        $documentA = Document::factory()->for($user)->create();
        $documentB = Document::factory()->for($user)->create();
        $commentOfA = Comment::factory()->for($documentA)->for($user)->create();

        $this->actingAs($user)
            ->deleteJson("/api/documents/{$documentB->id}/comments/{$commentOfA->id}")
            ->assertNotFound();

        $this->assertDatabaseHas('comments', ['id' => $commentOfA->id]);
    }

    /* ---------------- 线程回复 ---------------- */

    public function test_reply_threads_under_root_comment(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $root = Comment::factory()->for($document)->for($user)->create(['content' => '根评论']);

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments", [
                'content' => '这是回复',
                'parent_id' => $root->id,
            ])
            ->assertCreated()
            ->assertJsonPath('data.parent_id', $root->id);

        $this->assertDatabaseHas('comments', [
            'document_id' => $document->id,
            'content' => '这是回复',
            'parent_id' => $root->id,
        ]);
    }

    public function test_reply_to_reply_nests_under_target(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $root = Comment::factory()->for($document)->for($user)->create();
        $reply = Comment::factory()->for($document)->for($user)->create(['parent_id' => $root->id]);

        // 第 2 层回复保留真实 parent_id（前端渲染时第 3 层起才与第 2 层平级）
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments", [
                'content' => '回复的回复',
                'parent_id' => $reply->id,
            ])
            ->assertCreated()
            ->assertJsonPath('data.parent_id', $reply->id);
    }

    public function test_deep_reply_keeps_real_parent_id(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $root = Comment::factory()->for($document)->for($user)->create();
        $level1 = Comment::factory()->for($document)->for($user)->create(['parent_id' => $root->id]);
        $level2 = Comment::factory()->for($document)->for($user)->create(['parent_id' => $level1->id]);

        // 第 3 层及更深仍存真实被回复者，展示层级由前端封顶
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments", [
                'content' => '第三层回复',
                'parent_id' => $level2->id,
            ])
            ->assertCreated()
            ->assertJsonPath('data.parent_id', $level2->id);
    }

    public function test_reply_parent_must_belong_to_same_document(): void
    {
        $user = User::factory()->create();
        $documentA = Document::factory()->for($user)->create();
        $documentB = Document::factory()->for($user)->create();
        $foreignComment = Comment::factory()->for($documentB)->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$documentA->id}/comments", [
                'content' => '跨文档回复',
                'parent_id' => $foreignComment->id,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('parent_id');
    }

    /* ---------------- 解决标记 ---------------- */

    public function test_root_comment_can_be_resolved_and_reopened(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $root = Comment::factory()->for($document)->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments/{$root->id}/resolve", ['resolved' => true])
            ->assertOk()
            ->assertJsonPath('data.resolved_at', fn ($value) => $value !== null);

        $this->assertDatabaseHas('comments', ['id' => $root->id]);
        $this->assertNotNull($root->fresh()->resolved_at);

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments/{$root->id}/resolve", ['resolved' => false])
            ->assertOk();

        $this->assertNull($root->fresh()->resolved_at);
    }

    public function test_reply_cannot_be_resolved(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $root = Comment::factory()->for($document)->for($user)->create();
        $reply = Comment::factory()->for($document)->for($user)->create(['parent_id' => $root->id]);

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments/{$reply->id}/resolve", ['resolved' => true])
            ->assertStatus(422);

        $this->assertNull($reply->fresh()->resolved_at);
    }

    public function test_non_member_cannot_resolve_comment(): void
    {
        $owner = User::factory()->create();
        $stranger = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $root = Comment::factory()->for($document)->for($owner)->create();

        $this->actingAs($stranger)
            ->postJson("/api/documents/{$document->id}/comments/{$root->id}/resolve", ['resolved' => true])
            ->assertForbidden();

        $this->assertNull($root->fresh()->resolved_at);
    }

    public function test_unread_endpoint_reports_unresolved_root_count(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $root = Comment::factory()->for($document)->for($user)->create();
        Comment::factory()->for($document)->for($user)->create(['parent_id' => $root->id]);

        // 回复不计入未解决数：只数根
        $this->actingAs($user)
            ->getJson("/api/documents/{$document->id}/comments/unread")
            ->assertOk()
            ->assertJsonPath('data.unresolved', 1);

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/comments/{$root->id}/resolve", ['resolved' => true])
            ->assertOk();

        $this->actingAs($user)
            ->getJson("/api/documents/{$document->id}/comments/unread")
            ->assertOk()
            ->assertJsonPath('data.unresolved', 0);
    }
}
