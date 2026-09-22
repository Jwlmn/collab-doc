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
}
