<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UserSearchTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_cannot_search_users(): void
    {
        $this->getJson('/api/users/search')->assertUnauthorized();
    }

    public function test_search_returns_matching_users_with_id_and_name_only(): void
    {
        $me = User::factory()->create(['name' => '张三']);
        User::factory()->create(['name' => '李四']);
        User::factory()->create(['name' => '王五']);

        $response = $this->actingAs($me)
            ->getJson('/api/users/search?'.http_build_query(['q' => '李']))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', '李四')
            ->assertJsonPath('data.0.id', User::where('name', '李四')->value('id'));

        $this->assertArrayNotHasKey('email', $response->json('data.0'));
    }

    public function test_empty_query_returns_recent_users_capped_at_ten(): void
    {
        $me = User::factory()->create();
        User::factory()->count(15)->create();

        $this->actingAs($me)
            ->getJson('/api/users/search')
            ->assertOk()
            ->assertJsonCount(10, 'data');
    }
}
