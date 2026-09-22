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
}
