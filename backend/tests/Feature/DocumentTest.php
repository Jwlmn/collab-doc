<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DocumentTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_cannot_list_documents(): void
    {
        $this->getJson('/api/documents')->assertUnauthorized();
    }

    public function test_user_can_list_own_documents_only(): void
    {
        $user = User::factory()->create();
        $own = Document::factory()->for($user)->create(['title' => '我的文档']);
        Document::factory()->create(['title' => '别人的文档']);

        $this->actingAs($user)
            ->getJson('/api/documents')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $own->id)
            ->assertJsonPath('data.0.title', '我的文档');
    }

    public function test_user_can_create_document(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/api/documents', ['title' => '需求评审'])
            ->assertCreated()
            ->assertJsonPath('data.title', '需求评审')
            ->assertJsonPath('data.user_id', $user->id);

        $this->assertDatabaseHas('documents', [
            'user_id' => $user->id,
            'title' => '需求评审',
        ]);
    }

    public function test_create_document_uses_default_title(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/api/documents')
            ->assertCreated()
            ->assertJsonPath('data.title', '未命名文档')
            ->assertJsonPath('data.type', 'md');
    }

    public function test_create_document_with_type(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/api/documents', ['title' => '销售数据', 'type' => 'excel'])
            ->assertCreated()
            ->assertJsonPath('data.type', 'excel');

        $this->assertDatabaseHas('documents', [
            'user_id' => $user->id,
            'title' => '销售数据',
            'type' => 'excel',
        ]);
    }

    public function test_create_document_rejects_invalid_type(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/api/documents', ['type' => 'word'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('type');
    }

    public function test_user_can_update_own_document(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->putJson("/api/documents/{$document->id}", ['title' => '新标题'])
            ->assertOk()
            ->assertJsonPath('data.title', '新标题');

        $this->assertDatabaseHas('documents', ['id' => $document->id, 'title' => '新标题']);
    }

    public function test_user_cannot_update_others_document(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->create();

        $this->actingAs($user)
            ->putJson("/api/documents/{$document->id}", ['title' => '篡改'])
            ->assertForbidden();
    }

    public function test_user_cannot_view_others_document(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->create();

        $this->actingAs($user)
            ->getJson("/api/documents/{$document->id}")
            ->assertForbidden();
    }

    public function test_user_can_delete_own_document(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->deleteJson("/api/documents/{$document->id}")
            ->assertNoContent();

        // 软删除：进入回收站，数据行保留
        $this->assertSoftDeleted('documents', ['id' => $document->id]);
    }

    public function test_user_cannot_delete_others_document(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->create();

        $this->actingAs($user)
            ->deleteJson("/api/documents/{$document->id}")
            ->assertForbidden();

        $this->assertDatabaseHas('documents', ['id' => $document->id]);
    }

    public function test_update_requires_title(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->putJson("/api/documents/{$document->id}", [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('title');
    }
}
