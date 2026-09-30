<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ProfileTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_cannot_update_profile(): void
    {
        $this->putJson('/api/user', ['name' => '新名字'])->assertUnauthorized();
    }

    public function test_user_can_update_name_and_avatar(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->putJson('/api/user', [
                'name' => '新昵称',
                'avatar_url' => '/api/images/0f9e8d7c-6b5a-4c3d-2e1f-0a1b2c3d4e5f.png',
            ])
            ->assertOk()
            ->assertJsonPath('data.name', '新昵称')
            ->assertJsonPath('data.avatar_url', '/api/images/0f9e8d7c-6b5a-4c3d-2e1f-0a1b2c3d4e5f.png');

        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'name' => '新昵称',
        ]);
    }

    public function test_update_profile_rejects_external_avatar_url(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->putJson('/api/user', [
                'name' => $user->name,
                'avatar_url' => 'https://tracker.example.com/pixel.png',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('avatar_url');
    }

    public function test_update_profile_requires_name(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->putJson('/api/user', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('name');
    }

    public function test_password_change_rejects_wrong_current_password(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->putJson('/api/user/password', [
                'current_password' => 'wrong-password',
                'password' => 'new-secret-123',
                'password_confirmation' => 'new-secret-123',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('current_password');
    }

    public function test_password_change_updates_hash_and_old_password_stops_working(): void
    {
        $user = User::factory()->create(['password' => 'old-secret-123']);

        $this->actingAs($user)
            ->putJson('/api/user/password', [
                'current_password' => 'old-secret-123',
                'password' => 'new-secret-123',
                'password_confirmation' => 'new-secret-123',
            ])
            ->assertOk();

        // 登录路径的整体行为由 AuthTest 覆盖；这里验证哈希已换成新密码、旧密码失效
        $fresh = $user->fresh();
        $this->assertTrue(Hash::check('new-secret-123', $fresh->password));
        $this->assertFalse(Hash::check('old-secret-123', $fresh->password));
    }
}
