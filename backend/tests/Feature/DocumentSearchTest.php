<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\DocumentMember;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DocumentSearchTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_cannot_search(): void
    {
        $this->getJson('/api/documents/search?q=你好')->assertUnauthorized();
    }

    public function test_search_requires_query(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->getJson('/api/documents/search')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('q');

        $this->actingAs($user)
            ->getJson('/api/documents/search?q=')
            ->assertUnprocessable();
    }

    public function test_search_matches_own_document_title(): void
    {
        $user = User::factory()->create();
        Document::factory()->for($user)->create(['title' => '季度营销方案']);
        Document::factory()->for($user)->create(['title' => '技术架构设计']);

        $this->actingAs($user)
            ->getJson('/api/documents/search?'.http_build_query(['q' => '营销']))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.title', '季度营销方案');
    }

    public function test_search_matches_document_body_text(): void
    {
        $user = User::factory()->create();
        $hit = Document::factory()->for($user)->create(['title' => '会议纪要']);
        $hit->forceFill([
            'search_text' => '本周讨论了供应链金融的风险缓释措施',
        ])->save();

        Document::factory()->for($user)->create(['title' => '无关文档']);

        $response = $this->actingAs($user)
            ->getJson('/api/documents/search?'.http_build_query(['q' => '供应链金融']))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $hit->id);

        $this->assertNotEmpty($response->json('data.0.snippet'));
        $this->assertStringContainsString('供应链金融', $response->json('data.0.snippet'));
    }

    public function test_search_is_case_insensitive_for_ascii(): void
    {
        $user = User::factory()->create();
        Document::factory()->for($user)->create(['title' => 'Roadmap Review']);

        $this->actingAs($user)
            ->getJson('/api/documents/search?'.http_build_query(['q' => 'roadmap']))
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_search_includes_shared_documents_but_excludes_others(): void
    {
        $owner = User::factory()->create();
        $member = User::factory()->create();
        $stranger = User::factory()->create();

        $shared = Document::factory()->for($owner)->create(['title' => '共享的机密报告']);
        DocumentMember::factory()->for($shared)->for($member)->create(['role' => 'viewer']);

        Document::factory()->for($stranger)->create(['title' => '别人的机密报告']);

        // 成员可搜到共享文档
        $this->actingAs($member)
            ->getJson('/api/documents/search?'.http_build_query(['q' => '机密']))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $shared->id);

        // 无关用户搜不到
        $this->actingAs($stranger)
            ->getJson('/api/documents/search?'.http_build_query(['q' => '机密']))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.title', '别人的机密报告');
    }

    public function test_search_escapes_like_wildcards(): void
    {
        $user = User::factory()->create();
        Document::factory()->for($user)->create(['title' => '普通文档']);

        // % 不应作为通配符匹配所有文档
        $this->actingAs($user)
            ->getJson('/api/documents/search?'.http_build_query(['q' => '%']))
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_search_result_contains_role_and_snippet_fields(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create(['title' => '搜索字段检查']);

        $response = $this->actingAs($user)
            ->getJson('/api/documents/search?'.http_build_query(['q' => '字段']))
            ->assertOk();

        $this->assertSame('owner', $response->json('data.0.role'));
        $this->assertArrayHasKey('snippet', $response->json('data.0'));
        $this->assertNotNull($document->id);
    }
}
