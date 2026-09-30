<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\DocumentMember;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FolderTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_cannot_manage_folders(): void
    {
        $this->getJson('/api/folders')->assertUnauthorized();
        $this->postJson('/api/folders', ['name' => '工作'])->assertUnauthorized();
    }

    public function test_user_can_crud_own_folders(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/api/folders', ['name' => '工作'])
            ->assertCreated()
            ->assertJsonPath('data.name', '工作');

        $folder = Folder::firstOrFail();

        $this->actingAs($user)
            ->getJson('/api/folders')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.documents_count', 0);

        $this->actingAs($user)
            ->putJson("/api/folders/{$folder->id}", ['name' => '生活'])
            ->assertOk()
            ->assertJsonPath('data.name', '生活');

        $this->actingAs($user)
            ->deleteJson("/api/folders/{$folder->id}")
            ->assertOk();

        $this->assertDatabaseMissing('folders', ['id' => $folder->id]);
    }

    public function test_duplicate_folder_name_rejected_per_user(): void
    {
        $user = User::factory()->create();
        Folder::factory()->for($user)->create(['name' => '工作']);

        $this->actingAs($user)
            ->postJson('/api/folders', ['name' => '工作'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('name');
    }

    public function test_folders_are_isolated_between_users(): void
    {
        $owner = User::factory()->create();
        $stranger = User::factory()->create();
        $folder = Folder::factory()->for($owner)->create(['name' => '机密规划']);

        // 列表互不可见
        $this->actingAs($stranger)
            ->getJson('/api/folders')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        // 改名/删除他人的文件夹一律 404（不暴露存在性）
        $this->actingAs($stranger)
            ->putJson("/api/folders/{$folder->id}", ['name' => '改名'])
            ->assertNotFound();
        $this->actingAs($stranger)
            ->deleteJson("/api/folders/{$folder->id}")
            ->assertNotFound();

        $this->assertDatabaseHas('folders', ['id' => $folder->id, 'name' => '机密规划']);
    }

    public function test_member_can_file_document_into_own_folder(): void
    {
        $owner = User::factory()->create();
        $member = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        DocumentMember::factory()->for($document)->for($member)->create();
        $memberFolder = Folder::factory()->for($member)->create(['name' => '我整理的']);

        $this->actingAs($member)
            ->postJson("/api/documents/{$document->id}/folder", ['folder_id' => $memberFolder->id])
            ->assertOk()
            ->assertJsonPath('data.folder_id', $memberFolder->id);

        // 归属在成员自己的文件夹里：所有者视角不受影响
        $this->actingAs($owner)
            ->getJson('/api/documents')
            ->assertOk()
            ->assertJsonPath('data.0.folder_id', null);

        $this->actingAs($member)
            ->getJson('/api/documents')
            ->assertOk()
            ->assertJsonPath('data.0.folder_id', $memberFolder->id);
    }

    public function test_moving_document_clears_previous_folder(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $folderA = Folder::factory()->for($user)->create(['name' => 'A']);
        $folderB = Folder::factory()->for($user)->create(['name' => 'B']);

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/folder", ['folder_id' => $folderA->id])
            ->assertOk();
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/folder", ['folder_id' => $folderB->id])
            ->assertOk()
            ->assertJsonPath('data.folder_id', $folderB->id);

        // 单归属：旧文件夹里不再有该文档
        $this->assertDatabaseMissing('folder_documents', [
            'folder_id' => $folderA->id,
            'document_id' => $document->id,
        ]);
        $this->assertDatabaseHas('folder_documents', [
            'folder_id' => $folderB->id,
            'document_id' => $document->id,
        ]);
    }

    public function test_uncategorize_with_null_folder_id(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $folder = Folder::factory()->for($user)->create();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/folder", ['folder_id' => $folder->id])
            ->assertOk();

        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/folder", ['folder_id' => null])
            ->assertOk()
            ->assertJsonPath('data.folder_id', null);

        $this->assertDatabaseMissing('folder_documents', ['document_id' => $document->id]);
    }

    public function test_cannot_file_document_into_someone_elses_folder(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $strangerFolder = Folder::factory()->create(); // 属于另一个随机用户

        $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/folder", ['folder_id' => $strangerFolder->id])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('folder_id');
    }

    public function test_pin_response_keeps_viewer_folder_id(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $folder = Folder::factory()->for($user)->create();
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/folder", ['folder_id' => $folder->id])
            ->assertOk();

        // 回写列表行的响应必须带全视角关系，否则前端整行替换会把徽标/置顶冲掉
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/pin", ['pinned' => true])
            ->assertOk()
            ->assertJsonPath('data.folder_id', $folder->id)
            ->assertJsonPath('data.pinned', true);
    }

    public function test_update_response_keeps_folder_id_and_pin(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $folder = Folder::factory()->for($user)->create();
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/folder", ['folder_id' => $folder->id])
            ->assertOk();
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/pin", ['pinned' => true])
            ->assertOk();

        $this->actingAs($user)
            ->putJson("/api/documents/{$document->id}", ['title' => '改名后'])
            ->assertOk()
            ->assertJsonPath('data.title', '改名后')
            ->assertJsonPath('data.folder_id', $folder->id)
            ->assertJsonPath('data.pinned', true);
    }

    public function test_search_response_includes_folder_id(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create(['title' => '文件夹检索样张']);
        $folder = Folder::factory()->for($user)->create();
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/folder", ['folder_id' => $folder->id])
            ->assertOk();

        $this->actingAs($user)
            ->getJson('/api/documents/search?q='.urlencode('文件夹检索样张'))
            ->assertOk()
            ->assertJsonPath('data.0.folder_id', $folder->id);
    }

    public function test_deleting_folder_keeps_documents(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $folder = Folder::factory()->for($user)->create();
        $this->actingAs($user)
            ->postJson("/api/documents/{$document->id}/folder", ['folder_id' => $folder->id])
            ->assertOk();

        $this->actingAs($user)->deleteJson("/api/folders/{$folder->id}")->assertOk();

        // 文件夹没了，文档回到未分类且依然存在
        $this->assertDatabaseMissing('folder_documents', ['document_id' => $document->id]);
        $this->assertDatabaseHas('documents', ['id' => $document->id]);
    }
}
