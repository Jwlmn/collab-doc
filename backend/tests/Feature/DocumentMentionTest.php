<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\User;
use App\Notifications\DocumentMentionNotification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DocumentMentionTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_cannot_report_mentions(): void
    {
        $document = Document::factory()->create();

        $this->postJson("/api/documents/{$document->id}/mentions", ['user_ids' => [1]])
            ->assertUnauthorized();
    }

    public function test_first_mention_notifies_and_repeat_report_is_idempotent(): void
    {
        $owner = User::factory()->create();
        $mentioned = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/mentions", ['user_ids' => [$mentioned->id]])
            ->assertOk()
            ->assertJsonPath('data.notified', [$mentioned->id]);

        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $mentioned->id,
            'type' => DocumentMentionNotification::class,
        ]);

        // 重复上报：幂等，不再新增通知
        $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/mentions", ['user_ids' => [$mentioned->id]])
            ->assertOk()
            ->assertJsonPath('data.notified', []);

        $this->assertDatabaseCount('notifications', 1);
        $this->assertDatabaseCount('document_mentions', 1);
    }

    public function test_self_mention_is_skipped(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/mentions", ['user_ids' => [$owner->id]])
            ->assertOk()
            ->assertJsonPath('data.notified', []);

        $this->assertDatabaseCount('notifications', 0);
        $this->assertDatabaseCount('document_mentions', 0);
    }

    public function test_report_rejects_unknown_user_id(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/mentions", ['user_ids' => [999999]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('user_ids.0');
    }

    public function test_non_member_cannot_report_mentions(): void
    {
        $owner = User::factory()->create();
        $stranger = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $this->actingAs($stranger)
            ->postJson("/api/documents/{$document->id}/mentions", ['user_ids' => [$stranger->id]])
            ->assertForbidden();
    }
}
