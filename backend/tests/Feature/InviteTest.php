<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\DocumentMember;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class InviteTest extends TestCase
{
    use RefreshDatabase;

    private function makeLink(User $owner, Document $document): array
    {
        $response = $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/invite-link")
            ->assertOk();

        return $response->json('data');
    }

    public function test_guest_cannot_generate_or_accept(): void
    {
        $document = Document::factory()->create();

        $this->postJson("/api/documents/{$document->id}/invite-link")->assertUnauthorized();
        $this->postJson('/api/invite/abc.def')->assertUnauthorized();
    }

    public function test_owner_generates_invite_link(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $data = $this->makeLink($owner, $document);

        $this->assertArrayHasKey('token', $data);
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/', $data['token']);
        $this->assertSame('/invite/'.$data['token'], $data['path']);
    }

    public function test_non_owner_cannot_generate_invite_link(): void
    {
        $owner = User::factory()->create();
        $editor = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        DocumentMember::factory()->for($document)->for($editor)->create(['role' => 'editor']);

        $this->actingAs($editor)
            ->postJson("/api/documents/{$document->id}/invite-link")
            ->assertForbidden();
    }

    public function test_accept_valid_token_creates_viewer_membership(): void
    {
        $owner = User::factory()->create();
        $invitee = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $link = $this->makeLink($owner, $document);

        $this->actingAs($invitee)
            ->postJson('/api/invite/'.$link['token'])
            ->assertOk()
            ->assertJsonPath('data.document_id', $document->id)
            ->assertJsonPath('data.already', false);

        $this->assertDatabaseHas('document_members', [
            'document_id' => $document->id,
            'user_id' => $invitee->id,
            'role' => DocumentMember::ROLE_VIEWER,
        ]);
    }

    public function test_accept_is_idempotent_and_owner_recognized(): void
    {
        $owner = User::factory()->create();
        $invitee = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $link = $this->makeLink($owner, $document);

        // 第一次接受
        $this->actingAs($invitee)
            ->postJson('/api/invite/'.$link['token'])
            ->assertJsonPath('data.already', false);

        // 重复接受不产生重复成员
        $this->actingAs($invitee)
            ->postJson('/api/invite/'.$link['token'])
            ->assertJsonPath('data.already', true);

        $this->assertSame(
            1,
            $document->members()->where('user_id', $invitee->id)->count(),
        );

        // 所有者打开自己的邀请链接
        $this->actingAs($owner)
            ->postJson('/api/invite/'.$link['token'])
            ->assertJsonPath('data.already', true)
            ->assertJsonPath('data.document_id', $document->id);
    }

    public function test_invalid_token_returns_404(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/api/invite/not-a-valid.token')
            ->assertNotFound();

        // 篡改签名
        $this->actingAs($user)
            ->postJson('/api/invite/abc123.ZmFrZQ')
            ->assertNotFound();
    }
}
