<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TrashTest extends TestCase
{
    use RefreshDatabase;

    public function test_deleted_document_leaves_main_list_and_search(): void
    {
        $user = User::factory()->create();
        $doc = Document::factory()->for($user)->create(['title' => '待删文档']);

        $this->actingAs($user)->deleteJson("/api/documents/{$doc->id}")->assertNoContent();

        // 主列表不含
        $this->actingAs($user)
            ->getJson('/api/documents')
            ->assertOk()
            ->assertJsonMissingPath('data.0')
            ->assertJsonCount(0, 'data');

        // 搜索不含
        $this->actingAs($user)
            ->getJson('/api/documents/search?'.http_build_query(['q' => '待删']))
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_trashed_list_shows_soft_deleted_documents(): void
    {
        $user = User::factory()->create();
        $keep = Document::factory()->for($user)->create(['title' => '正常文档']);
        $deleted = Document::factory()->for($user)->create(['title' => '回收站文档']);
        $deleted->delete();

        $response = $this->actingAs($user)->getJson('/api/documents/trashed')->assertOk();

        $this->assertSame(['回收站文档'], array_column($response->json('data'), 'title'));
        $this->assertNotContains($keep->id, array_column($response->json('data'), 'id'));
    }

    public function test_owner_can_restore_document(): void
    {
        $user = User::factory()->create();
        $doc = Document::factory()->for($user)->create(['title' => '恢复我']);
        $doc->delete();

        $this->actingAs($user)
            ->postJson("/api/documents/{$doc->id}/restore")
            ->assertOk()
            ->assertJsonPath('data.title', '恢复我');

        $this->assertDatabaseHas('documents', ['id' => $doc->id, 'deleted_at' => null]);

        // 恢复后回到主列表
        $this->actingAs($user)
            ->getJson('/api/documents')
            ->assertJsonCount(1, 'data');
    }

    public function test_owner_can_force_delete(): void
    {
        $user = User::factory()->create();
        $doc = Document::factory()->for($user)->create();
        $doc->delete();

        $this->actingAs($user)
            ->deleteJson("/api/documents/{$doc->id}/force")
            ->assertNoContent();

        $this->assertDatabaseMissing('documents', ['id' => $doc->id]);
    }

    public function test_others_cannot_touch_trashed_document(): void
    {
        $owner = User::factory()->create();
        $stranger = User::factory()->create();
        $doc = Document::factory()->for($owner)->create();
        $doc->delete();

        // 非本人：恢复/彻底删除均404（不泄露存在性）
        $this->actingAs($stranger)
            ->postJson("/api/documents/{$doc->id}/restore")
            ->assertNotFound();

        $this->actingAs($stranger)
            ->deleteJson("/api/documents/{$doc->id}/force")
            ->assertNotFound();

        // 回收站列表互不可见
        $this->actingAs($stranger)
            ->getJson('/api/documents/trashed')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_guest_cannot_access_trash(): void
    {
        $user = User::factory()->create();
        $doc = Document::factory()->create();
        $doc->delete();

        $this->getJson('/api/documents/trashed')->assertUnauthorized();
        $this->postJson("/api/documents/{$doc->id}/restore")->assertUnauthorized();
    }

    public function test_trashed_document_is_invisible_to_normal_routes(): void
    {
        $user = User::factory()->create();
        $doc = Document::factory()->for($user)->create();
        $doc->delete();

        // 常规 show / collab-token / 评论等隐式绑定均不可达
        $this->actingAs($user)
            ->getJson("/api/documents/{$doc->id}")
            ->assertNotFound();

        $this->actingAs($user)
            ->postJson("/api/documents/{$doc->id}/collab-token")
            ->assertNotFound();
    }
}
