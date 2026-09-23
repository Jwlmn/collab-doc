<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\DocumentMember;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DocumentMemberTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_can_add_member_with_role(): void
    {
        $owner = User::factory()->create();
        $invitee = User::factory()->create(['email' => 'invitee@example.com']);
        $document = Document::factory()->for($owner)->create();

        $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/members", [
                'email' => 'invitee@example.com',
                'role' => 'editor',
            ])
            ->assertCreated()
            ->assertJsonPath('data.role', 'editor')
            ->assertJsonPath('data.user.id', $invitee->id);

        $this->assertDatabaseHas('document_members', [
            'document_id' => $document->id,
            'user_id' => $invitee->id,
            'role' => 'editor',
        ]);
    }

    public function test_add_member_rejects_unknown_email_and_bad_role(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/members", [
                'email' => 'nobody@example.com',
                'role' => 'editor',
            ])
            ->assertStatus(422);

        $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/members", [
                'email' => 'invitee@example.com',
                'role' => 'admin',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('role');
    }

    public function test_cannot_add_owner_as_member_or_duplicate_member(): void
    {
        $owner = User::factory()->create(['email' => 'owner@example.com']);
        $document = Document::factory()->for($owner)->create();

        $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/members", [
                'email' => 'owner@example.com',
                'role' => 'editor',
            ])
            ->assertStatus(422);

        User::factory()->create(['email' => 'invitee@example.com']);
        $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/members", [
                'email' => 'invitee@example.com',
                'role' => 'viewer',
            ])
            ->assertCreated();

        $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/members", [
                'email' => 'invitee@example.com',
                'role' => 'editor',
            ])
            ->assertStatus(422);
    }

    public function test_non_owner_cannot_manage_members(): void
    {
        $owner = User::factory()->create();
        $editor = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $member = DocumentMember::factory()->for($document)->for($editor)->create(['role' => 'editor']);

        $this->actingAs($editor)
            ->postJson("/api/documents/{$document->id}/members", [
                'email' => 'x@example.com',
                'role' => 'viewer',
            ])
            ->assertForbidden();

        $this->actingAs($editor)
            ->putJson("/api/documents/{$document->id}/members/{$member->id}", ['role' => 'viewer'])
            ->assertForbidden();

        $this->actingAs($editor)
            ->deleteJson("/api/documents/{$document->id}/members/{$member->id}")
            ->assertForbidden();
    }

    public function test_owner_can_update_role_and_remove_member(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $member = DocumentMember::factory()->for($document)->create(['role' => 'viewer']);

        $this->actingAs($owner)
            ->putJson("/api/documents/{$document->id}/members/{$member->id}", ['role' => 'editor'])
            ->assertOk()
            ->assertJsonPath('data.role', 'editor');

        $this->actingAs($owner)
            ->deleteJson("/api/documents/{$document->id}/members/{$member->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('document_members', ['id' => $member->id]);
    }

    public function test_member_can_view_document_with_role(): void
    {
        $owner = User::factory()->create(['name' => '所有者']);
        $viewer = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        DocumentMember::factory()->for($document)->for($viewer)->create(['role' => 'viewer']);

        $this->actingAs($viewer)
            ->getJson("/api/documents/{$document->id}")
            ->assertOk()
            ->assertJsonPath('data.role', 'viewer')
            ->assertJsonPath('data.owner.name', '所有者');
    }

    public function test_shared_documents_appear_in_index_with_role(): void
    {
        $owner = User::factory()->create();
        $editor = User::factory()->create();
        $document = Document::factory()->for($owner)->create(['title' => '共享文档']);
        DocumentMember::factory()->for($document)->for($editor)->create(['role' => 'editor']);

        $this->actingAs($editor)
            ->getJson('/api/documents')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.title', '共享文档')
            ->assertJsonPath('data.0.role', 'editor')
            // 成员摘要供列表头像叠堆使用
            ->assertJsonCount(1, 'data.0.members')
            ->assertJsonPath('data.0.members.0.id', $editor->id)
            ->assertJsonPath('data.0.members.0.role', 'editor');
    }

    public function test_viewer_cannot_edit_but_editor_can(): void
    {
        $owner = User::factory()->create();
        $viewer = User::factory()->create();
        $editor = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        DocumentMember::factory()->for($document)->for($viewer)->create(['role' => 'viewer']);
        DocumentMember::factory()->for($document)->for($editor)->create(['role' => 'editor']);

        $versionPayload = [
            'content_json' => ['type' => 'doc'],
            'content_html' => '<p>x</p>',
        ];

        $this->actingAs($viewer)
            ->postJson("/api/documents/{$document->id}/versions", $versionPayload)
            ->assertForbidden();

        $this->actingAs($editor)
            ->postJson("/api/documents/{$document->id}/versions", $versionPayload)
            ->assertCreated();
    }

    public function test_members_are_visible_to_any_member_but_manage_is_owner_only(): void
    {
        $owner = User::factory()->create();
        $viewer = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        DocumentMember::factory()->for($document)->for($viewer)->create(['role' => 'viewer']);

        $this->actingAs($viewer)
            ->getJson("/api/documents/{$document->id}/members")
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_member_scoped_to_its_document(): void
    {
        $owner = User::factory()->create();
        $documentA = Document::factory()->for($owner)->create();
        $documentB = Document::factory()->for($owner)->create();
        $member = DocumentMember::factory()->for($documentA)->create();

        $this->actingAs($owner)
            ->putJson("/api/documents/{$documentB->id}/members/{$member->id}", ['role' => 'editor'])
            ->assertNotFound();
    }

    public function test_owner_can_search_invitees_by_name_or_email(): void
    {
        $owner = User::factory()->create();
        $byName = User::factory()->create(['name' => '张三丰', 'email' => 'zhangsan@example.com']);
        $byEmail = User::factory()->create(['name' => '李四', 'email' => 'lisi@corp.example']);
        User::factory()->create(['name' => '王五', 'email' => 'wang@example.com']);
        $document = Document::factory()->for($owner)->create();

        // 按用户名搜
        $this->actingAs($owner)
            ->getJson("/api/documents/{$document->id}/members/search?".http_build_query(['q' => '张']))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $byName->id)
            ->assertJsonPath('data.0.email', 'zhangsan@example.com');

        // 按邮箱关键词搜
        $this->actingAs($owner)
            ->getJson("/api/documents/{$document->id}/members/search?".http_build_query(['q' => 'lisi@']))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $byEmail->id);
    }

    public function test_invite_search_excludes_owner_and_existing_members(): void
    {
        $owner = User::factory()->create(['name' => '老大']);
        $existing = User::factory()->create(['name' => '老成员']);
        $stranger = User::factory()->create(['name' => '老王']);
        $document = Document::factory()->for($owner)->create();
        DocumentMember::factory()->for($document)->for($existing)->create(['role' => 'viewer']);

        $response = $this->actingAs($owner)
            ->getJson("/api/documents/{$document->id}/members/search?".http_build_query(['q' => '老']))
            ->assertOk();

        $this->assertSame([$stranger->id], array_column($response->json('data'), 'id'));
    }

    public function test_invite_search_empty_query_returns_empty(): void
    {
        $owner = User::factory()->create();
        User::factory()->count(3)->create();
        $document = Document::factory()->for($owner)->create();

        $this->actingAs($owner)
            ->getJson("/api/documents/{$document->id}/members/search")
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_invite_search_is_owner_only(): void
    {
        $owner = User::factory()->create();
        $editor = User::factory()->create();
        $stranger = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        DocumentMember::factory()->for($document)->for($editor)->create(['role' => 'editor']);

        $this->actingAs($editor)
            ->getJson("/api/documents/{$document->id}/members/search?q=x")
            ->assertForbidden();

        $this->actingAs($stranger)
            ->getJson("/api/documents/{$document->id}/members/search?q=x")
            ->assertForbidden();
    }

    public function test_guest_cannot_search_invitees(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $this->getJson("/api/documents/{$document->id}/members/search?q=x")
            ->assertUnauthorized();
    }
}
