<?php

namespace Tests\Feature;

use App\Models\Document;
use App\Models\User;
use App\Notifications\MentionNotification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationTest extends TestCase
{
    use RefreshDatabase;

    public function test_mention_creates_database_notification(): void
    {
        $author = User::factory()->create(['name' => '作者']);
        $mentioned = User::factory()->create();
        $document = Document::factory()->for($author)->create(['title' => '通知测试文档']);

        $this->actingAs($author)
            ->postJson("/api/documents/{$document->id}/comments", [
                'content' => "@[某人](user:{$mentioned->id}) 请看",
            ])
            ->assertCreated();

        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $mentioned->id,
            'notifiable_type' => User::class,
            'read_at' => null,
        ]);

        $payload = json_decode(
            \DB::table('notifications')->where('notifiable_id', $mentioned->id)->value('data'),
            true,
        );
        $this->assertSame('mention', $payload['kind']);
        $this->assertSame($document->id, $payload['document_id']);
        $this->assertSame('md', $payload['doc_type']);
    }

    public function test_mentioning_self_does_not_notify(): void
    {
        $author = User::factory()->create();
        $document = Document::factory()->for($author)->create();

        $this->actingAs($author)
            ->postJson("/api/documents/{$document->id}/comments", [
                'content' => "@[自己](user:{$author->id}) 自言自语",
            ])
            ->assertCreated();

        $this->assertDatabaseCount('notifications', 0);
    }

    public function test_sharing_document_notifies_invitee(): void
    {
        $owner = User::factory()->create(['name' => '所有者']);
        $invitee = User::factory()->create();
        $document = Document::factory()->for($owner)->create(['title' => '共享通知文档']);

        $this->actingAs($owner)
            ->postJson("/api/documents/{$document->id}/members", [
                'email' => $invitee->email,
                'role' => 'viewer',
            ])
            ->assertCreated();

        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $invitee->id,
            'notifiable_type' => User::class,
        ]);

        $payload = json_decode(
            \DB::table('notifications')->where('notifiable_id', $invitee->id)->value('data'),
            true,
        );
        $this->assertSame('shared', $payload['kind']);
        $this->assertSame('viewer', $payload['role']);
    }

    public function test_notification_list_and_unread_count(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $other = User::factory()->create();

        // 产生两条：共享给自己模拟（直接建通知）+ 提及
        $document->comments()->create([
            'content' => "@[你](user:{$user->id})",
            'user_id' => $other->id,
            'mentions' => [$user->id],
        ]);
        $user->notify(new MentionNotification(
            $document->comments()->first(),
        ));

        $this->assertDatabaseCount('notifications', 1);

        $response = $this->actingAs($user)
            ->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('unread', 1);

        $id = $response->json('data.0.id');

        // 标单条已读
        $this->actingAs($user)
            ->postJson("/api/notifications/{$id}/read")
            ->assertOk()
            ->assertJsonPath('data.unread', 0);
    }

    public function test_mark_all_read(): void
    {
        $user = User::factory()->create();
        $document = Document::factory()->for($user)->create();
        $other = User::factory()->create();

        foreach (range(1, 3) as $i) {
            $comment = $document->comments()->create([
                'content' => "c{$i}",
                'user_id' => $other->id,
            ]);
            $user->notify(new MentionNotification($comment));
        }

        $this->actingAs($user)->getJson('/api/notifications')->assertJsonPath('unread', 3);

        $this->actingAs($user)
            ->postJson('/api/notifications/read-all')
            ->assertOk()
            ->assertJsonPath('data.unread', 0);

        $this->assertSame(0, $user->unreadNotifications()->count());
    }

    public function test_cannot_read_others_notification(): void
    {
        $owner = User::factory()->create();
        $stranger = User::factory()->create();
        $document = Document::factory()->for($owner)->create();
        $comment = $document->comments()->create([
            'content' => 'x',
            'user_id' => $owner->id,
        ]);
        $owner->notify(new MentionNotification($comment));

        $id = \DB::table('notifications')->value('id');

        $this->actingAs($stranger)
            ->postJson("/api/notifications/{$id}/read")
            ->assertNotFound();

        $this->actingAs($stranger)
            ->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_guest_cannot_access_notifications(): void
    {
        $this->getJson('/api/notifications')->assertUnauthorized();
    }
}
