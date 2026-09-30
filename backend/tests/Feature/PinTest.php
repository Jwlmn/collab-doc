<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\DocumentMember;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PinTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_cannot_pin_document(): void
    {
        $document = Document::factory()->create();

        $this->postJson("/api/documents/{$document->id}/pin", ['pinned' => true])
            ->assertUnauthorized();
    }

    public function test_user_can_pin_own_document_and_sees_pinned_flag_in_list(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/pin", ['pinned' => true])
            ->assertOk()
            ->assertJsonPath('data.pinned', true);

        $this->assertDatabaseHas('document_pins', [
            'user_id' => $user->id,
            'document_id' => $document->id,
        ]);

        $this->actingAs($user)
            ->getJson('/api/documents')
            ->assertOk()
            ->assertJsonPath('data.0.pinned', true);
    }

    public function test_unpin_removes_pin_record_and_clears_flag(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/pin", ['pinned' => true])
            ->assertOk();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/pin", ['pinned' => false])
            ->assertOk()
            ->assertJsonPath('data.pinned', false);

        $this->assertDatabaseMissing('document_pins', [
            'user_id' => $user->id,
            'document_id' => $document->id,
        ]);
    }

    public function test_pin_is_independent_between_users(): void
    {
        $owner = User::factory()->create();
        $member = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        DocumentMember::factory()->for($document)->for($member)->create();

        $this->actingAs($member)
            ->postJson("/api/documents/{$document->id}/pin", ['pinned' => true])
            ->assertOk()
            ->assertJsonPath('data.pinned', true);

        $this->actingAs($owner)
            ->getJson('/api/documents')
            ->assertOk()
            ->assertJsonPath('data.0.pinned', false);

        $this->actingAs($member)
            ->getJson('/api/documents')
            ->assertOk()
            ->assertJsonPath('data.0.pinned', true);
    }

    public function test_viewer_member_can_pin_shared_document(): void
    {
        $owner = User::factory()->create();
        $viewer = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        DocumentMember::factory()->for($document)->for($viewer)->create(['role' => 'viewer']);

        $this->actingAs($viewer)
            ->postJson("/api/documents/{$document->id}/pin", ['pinned' => true])
            ->assertOk()
            ->assertJsonPath('data.pinned', true);
    }

    public function test_non_member_cannot_pin_document(): void
    {
        $owner = User::factory()->create();
        $stranger = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $this->actingAs($stranger)
            ->postJson("/api/documents/{$document->id}/pin", ['pinned' => true])
            ->assertForbidden();

        $this->assertDatabaseMissing('document_pins', [
            'user_id' => $stranger->id,
            'document_id' => $document->id,
        ]);
    }

    public function test_pin_requires_pinned_field(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/pin", [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('pinned');
    }

    public function test_cannot_pin_trashed_document(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $document->delete();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/pin", ['pinned' => true])
            ->assertNotFound();
    }
}
