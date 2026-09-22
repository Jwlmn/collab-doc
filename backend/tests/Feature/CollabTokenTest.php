<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\DocumentMember;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CollabTokenTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_cannot_get_collab_token(): void
    {
        $document = Document::factory()->create();

        $this->postJson("/api/documents/{$document->id}/collab-token")->assertUnauthorized();
    }

    public function test_owner_gets_signed_token_with_owner_role(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $response = $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/collab-token")
            ->assertOk()
            ->assertJsonPath('data.role', 'owner');

        $token = $response->json('data.token');
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/', $token);

        [$payload] = explode('.', $token);
        $decoded = json_decode(base64_decode(strtr($payload, '-_', '+/')), true);

        $this->assertSame('doc-'.$document->id, $decoded['document']);
        $this->assertSame($owner->id, $decoded['uid']);
        $this->assertSame('owner', $decoded['role']);
        $this->assertGreaterThan(time(), $decoded['exp']);
    }

    public function test_viewer_gets_viewer_role_token(): void
    {
        $owner = User::factory()->create();
        $viewer = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        DocumentMember::factory()->for($document)->for($viewer)->create(['role' => 'viewer']);

        $this->actingAs($viewer)
            ->postJson("/api/documents/{$document->id}/collab-token")
            ->assertOk()
            ->assertJsonPath('data.role', 'viewer');
    }

    public function test_stranger_cannot_get_collab_token(): void
    {
        $owner = User::factory()->create();
        $stranger = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $this->actingAs($stranger)
            ->postJson("/api/documents/{$document->id}/collab-token")
            ->assertForbidden();
    }
}
