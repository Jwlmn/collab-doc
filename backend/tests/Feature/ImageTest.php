<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ImageTest extends TestCase
{
    use RefreshDatabase;

    /** 造一张合法 PNG（1x1） */
    private function pngFile(): UploadedFile
    {
        return UploadedFile::fake()->image('photo.png', 4, 4);
    }

    public function test_guest_cannot_upload_image(): void
    {
        $this->postJson('/api/images', ['file' => $this->pngFile()])->assertUnauthorized();
    }

    public function test_user_can_upload_image(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();

        $response = $this->actingAs($user)
            ->postJson('/api/images', ['file' => $this->pngFile()])
            ->assertCreated()
            ->assertJsonStructure(['data' => ['url', 'filename', 'size']]);

        $url = $response->json('data.url');
        // 相对路径，避免 APP_URL 变更挂掉存量图片
        $this->assertStringStartsWith('/api/images/', $url);
        $this->assertMatchesRegularExpression('#^/api/images/[0-9a-f\-]+\.png$#', $url);
        Storage::disk('local')->assertExists('images/'.$response->json('data.filename'));
    }

    public function test_upload_rejects_disallowed_mime(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/api/images', ['file' => UploadedFile::fake()->create('doc.php', 10, 'application/x-php')])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['file']);
    }

    public function test_upload_rejects_oversized_file(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/api/images', ['file' => UploadedFile::fake()->create('big.png', 6000, 'image/png')])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['file']);
    }

    public function test_uploaded_image_is_served_and_readable_without_auth(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();

        $url = $this->actingAs($user)
            ->postJson('/api/images', ['file' => $this->pngFile()])
            ->json('data.url');

        // 访客（分享页）也要能读图
        $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/png');
    }

    public function test_path_traversal_is_rejected(): void
    {
        Storage::fake('local');

        // 非 UUID 形态 / 带路径分隔符 → 404（不落到磁盘）
        $this->get('/api/images/../../etc/passwd')->assertNotFound();
        $this->get('/api/images/not-a-uuid.png')->assertNotFound();
        $this->get('/api/images/'.str_repeat('a', 30).'.png')->assertNotFound();
    }

    public function test_missing_file_returns_404(): void
    {
        $this->get('/api/images/00000000-0000-4000-8000-000000000000.png')->assertNotFound();
    }
}
