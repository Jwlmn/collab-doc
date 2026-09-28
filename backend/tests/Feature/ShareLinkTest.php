<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\User;
use App\Support\HmacToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ShareLinkTest extends TestCase
{
    use RefreshDatabase;

    /** 造一枚有效分享令牌 */
    private function makeToken(Document $document, array $overrides = []): string
    {
        return HmacToken::issueJson('share', array_merge([
            'd' => $document->id,
            'exp' => 0,
            'v' => $document->share_version ?? 0,
        ], $overrides));
    }

    public function test_owner_can_create_share_link(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $response = $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/share-link", ['expires_in_days' => 7])
            ->assertOk()
            ->assertJsonStructure(['data' => ['token', 'path', 'expires_at']]);

        $this->assertStringStartsWith('/share/', $response->json('data.path'));
        $this->assertNotNull($response->json('data.expires_at'));
    }

    public function test_non_owner_cannot_create_share_link(): void
    {
        $owner = User::factory()->create();
        $stranger = User::factory()->create();
        $document = Document::factory()->for($owner)->create();

        $this->actingAs($stranger)
            ->postJson("/api/documents/{$document->id}/share-link")
            ->assertForbidden();

        $this->actingAs($stranger)
            ->deleteJson("/api/documents/{$document->id}/share-link")
            ->assertForbidden();
    }

    public function test_guest_can_resolve_valid_share_link(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create(['title' => '分享测试文档']);

        $token = $this->makeToken($document);

        $this->getJson("/api/share/{$token}")
            ->assertOk()
            ->assertJsonPath('data.document.title', '分享测试文档')
            ->assertJsonPath('data.document.type', 'md')
            // 访客固定 viewer，驱动前端只读态
            ->assertJsonPath('data.document.role', 'viewer');
    }

    public function test_guest_collab_token_is_viewer_readonly(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $token = $this->makeToken($document);

        $response = $this->getJson("/api/share/{$token}/collab-token")
            ->assertOk()
            ->assertJsonPath('data.role', 'viewer');

        $collabToken = $response->json('data.token');
        [$payload] = explode('.', $collabToken);
        $decoded = json_decode(base64_decode(strtr($payload, '-_', '+/')), true);

        $this->assertSame('doc-'.$document->id, $decoded['document']);
        $this->assertSame('viewer', $decoded['role']);
        // uid=0：匿名访客，协作服务器只用它打日志
        $this->assertSame(0, $decoded['uid']);
        $this->assertGreaterThan(time(), $decoded['exp']);
    }

    public function test_existing_collab_token_endpoint_still_rejects_guests(): void
    {
        $document = Document::factory()->create();

        // 分享走的是另一条路由，原端点的 401 契约必须原样保留
        $this->postJson("/api/documents/{$document->id}/collab-token")->assertUnauthorized();
    }

    public function test_bad_signature_returns_404_not_401(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $token = $this->makeToken($document);

        [$payload, $signature] = explode('.', $token);
        // 篡改签名（注意保持 base64url 字符集）
        $bad = $payload.'.'.strrev($signature);

        $this->getJson("/api/share/{$bad}")->assertNotFound();
        $this->getJson("/api/share/{$bad}/collab-token")->assertNotFound();
    }

    public function test_expired_share_link_returns_404(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $token = $this->makeToken($document, ['exp' => time() - 60]);

        $this->getJson("/api/share/{$token}")->assertNotFound();
    }

    public function test_wrong_purpose_token_is_rejected(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        // 用 invite 用途签的令牌不能当 share 令牌用（跨用途重放）
        $inviteToken = HmacToken::issue('invite', (string) $document->id);

        $this->getJson("/api/share/{$inviteToken}")->assertNotFound();
    }

    public function test_trashed_document_share_link_returns_404(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $token = $this->makeToken($document);

        $document->delete();

        $this->getJson("/api/share/{$token}")->assertNotFound();
    }

    public function test_revoke_kills_all_outstanding_links(): void
    {
        $owner = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $tokenBefore = $this->makeToken($document, ['v' => 0]);

        $this->getJson("/api/share/{$tokenBefore}")->assertOk();

        $this->actingAs($owner)
            ->deleteJson("/api/documents/{$document->id}/share-link")
            ->assertNoContent();

        // 旧链接（v=0）立即失效
        $this->getJson("/api/share/{$tokenBefore}")->assertNotFound();
        $this->getJson("/api/share/{$tokenBefore}/collab-token")->assertNotFound();

        // 重新签发的新链接（v=1）可用
        $fresh = $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/share-link")
            ->json('data.token');
        $this->getJson("/api/share/{$fresh}")->assertOk();
    }

    public function test_share_link_discloses_no_members_or_email(): void
    {
        $owner = User::factory()->create(['name' => '文档主人']);
        $document = Document::factory()->for($owner)->create();
        $token = $this->makeToken($document);

        $payload = $this->getJson("/api/share/{$token}")->assertOk()->json('data.document');

        // 最小披露：不返回成员列表、不返回任何邮箱
        $this->assertArrayNotHasKey('members', $payload);
        $this->assertArrayNotHasKey('email', $payload);
        $this->assertArrayNotHasKey('email', $payload['owner']);
        $this->assertSame('文档主人', $payload['owner']['name']);
    }
}
