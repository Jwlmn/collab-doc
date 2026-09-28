<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DocumentVersionTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return array<string, mixed>
     */
    private function validPayload(): array
    {
        return [
            'name' => '初稿',
            'content_json' => [
                'type' => 'doc',
                'content' => [
                    ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => '第一版内容']]],
                ],
            ],
            'content_html' => '<p>第一版内容</p>',
        ];
    }

    public function test_guest_cannot_access_versions(): void
    {
        $document = Document::factory()->create();

        $this->getJson("/api/documents/{$document->id}/versions")->assertUnauthorized();
        $this->postJson("/api/documents/{$document->id}/versions", $this->validPayload())->assertUnauthorized();
    }

    public function test_owner_can_save_version(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/versions", $this->validPayload())
            ->assertCreated()
            ->assertJsonPath('data.name', '初稿')
            ->assertJsonPath('data.content_html', '<p>第一版内容</p>')
            ->assertJsonPath('data.user.name', $user->name);

        $this->assertDatabaseHas('document_versions', [
            'document_id' => $document->id,
            'user_id' => $user->id,
            'name' => '初稿',
        ]);
    }

    public function test_save_version_requires_content(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/versions", ['name' => '空版本'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['content_json', 'content_html']);
    }

    public function test_owner_can_list_versions_newest_first(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $older = DocumentVersion::factory()->for($document)->for($user)->create(['name' => '旧版本']);
        $newer = DocumentVersion::factory()->for($document)->for($user)->create(['name' => '新版本']);

        $this->actingAs($user)
            ->getJson("/api/documents/{$document->id}/versions")
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.id', $newer->id)
            ->assertJsonPath('data.1.id', $older->id)
            // 列表不携带可能很大的内容字段
            ->assertJsonMissingPath('data.0.content_json')
            ->assertJsonMissingPath('data.0.content_html');
    }

    public function test_owner_can_view_version_content(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $version = DocumentVersion::factory()->for($document)->for($user)->create([
            'content_html' => '<p>快照内容</p>',
        ]);

        $this->actingAs($user)
            ->getJson("/api/documents/{$document->id}/versions/{$version->id}")
            ->assertOk()
            ->assertJsonPath('data.content_html', '<p>快照内容</p>')
            ->assertJsonPath('data.content_json.type', 'doc');
    }

    public function test_owner_can_delete_version(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $version = DocumentVersion::factory()->for($document)->for($user)->create();

        $this->actingAs($user)
            ->deleteJson("/api/documents/{$document->id}/versions/{$version->id}")
            ->assertNoContent();

        $this->assertDatabaseMissing('document_versions', ['id' => $version->id]);
    }

    public function test_non_owner_cannot_access_versions(): void
    {
        $owner = User::factory()->create();
        $intruder = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $version = DocumentVersion::factory()->for($document)->for($owner)->create();

        $this->actingAs($intruder)
            ->getJson("/api/documents/{$document->id}/versions")
            ->assertForbidden();

        $this->actingAs($intruder)
            ->postJson("/api/documents/{$document->id}/versions", $this->validPayload())
            ->assertForbidden();

        $this->actingAs($intruder)
            ->getJson("/api/documents/{$document->id}/versions/{$version->id}")
            ->assertForbidden();

        $this->actingAs($intruder)
            ->deleteJson("/api/documents/{$document->id}/versions/{$version->id}")
            ->assertForbidden();
    }

    public function test_version_belongs_to_target_document_only(): void
    {
        $user = User::factory()->create();
        $documentA = Document::factory()->for($user)->create();
        $documentB = Document::factory()->for($user)->create();
        $versionOfA = DocumentVersion::factory()->for($documentA)->for($user)->create();

        // 用文档 B 的路径访问文档 A 的版本 → 404（scoped binding）
        $this->actingAs($user)
            ->getJson("/api/documents/{$documentB->id}/versions/{$versionOfA->id}")
            ->assertNotFound();
    }

    public function test_list_returns_kind_field(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        DocumentVersion::factory()->for($document)->for($user)->create(['kind' => 'auto']);

        $this->actingAs($user)
            ->getJson("/api/documents/{$document->id}/versions")
            ->assertOk()
            ->assertJsonPath('data.0.kind', 'auto');
    }

    public function test_kind_rejects_restore_source(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/versions", $this->validPayload() + ['kind' => 'restore'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['kind']);
    }

    public function test_content_hash_is_computed_server_side(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        // 客户端伪造 content_hash 也不生效：服务端按 content_json 重新计算
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/versions", $this->validPayload() + ['content_hash' => 'deadbeef'])
            ->assertCreated();

        $expected = hash('sha256', json_encode($this->validPayload()['content_json'], JSON_UNESCAPED_UNICODE));
        $this->assertDatabaseHas('document_versions', [
            'document_id' => $document->id,
            'content_hash' => $expected,
        ]);
    }

    public function test_duplicate_content_with_same_name_is_deduped(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/versions", $this->validPayload())
            ->assertCreated();

        // 同内容同名再存一次 → 不新建
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/versions", $this->validPayload())
            ->assertOk();

        $this->assertSame(1, $document->versions()->count());
    }

    public function test_same_content_under_different_name_still_creates(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/versions", $this->validPayload())
            ->assertCreated();
        $renamed = array_merge($this->validPayload(), ['name' => '终稿']);
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/versions", $renamed)
            ->assertCreated();

        $this->assertSame(2, $document->versions()->count());
    }

    public function test_auto_snapshot_is_rate_limited_within_window(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/versions", $this->validPayload() + ['kind' => 'auto'])
            ->assertCreated();

        // 内容变了但仍在 5 分钟窗口内 → 复用上一条
        $second = array_merge($this->validPayload(), [
            'kind' => 'auto',
            'content_json' => ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => '第二版']]]]],
            'content_html' => '<p>第二版</p>',
        ]);
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/versions", $second)
            ->assertOk();

        $this->assertSame(1, $document->versions()->count());
    }

    public function test_auto_snapshot_created_after_window_is_kept(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        DocumentVersion::factory()->for($document)->for($user)->create([
            'kind' => 'auto',
            'created_at' => now()->subMinutes(10),
        ]);

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/versions", $this->validPayload() + ['kind' => 'auto'])
            ->assertCreated();

        $this->assertSame(2, $document->versions()->count());
    }

    public function test_auto_snapshots_are_pruned_beyond_cap(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        // 造 20 条自动快照（10 分钟前，绕开限流窗口）
        DocumentVersion::factory()->count(20)->for($document)->for($user)->create([
            'kind' => 'auto',
            'created_at' => now()->subMinutes(10),
        ]);

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/versions", $this->validPayload() + ['kind' => 'auto'])
            ->assertCreated();

        // 20 条旧的 + 1 条新的 = 21，超出上限 20 → 最旧一条被淘汰
        $this->assertSame(20, $document->versions()->where('kind', 'auto')->count());
    }
}
