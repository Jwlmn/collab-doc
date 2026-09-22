<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    /**
     * 当前用户的站内通知（最近 20 条 + 未读数）。
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $notifications = $user->notifications()->latest()->limit(20)->get()->map(fn ($n) => [
            'id' => $n->id,
            'type' => $n->type,
            'data' => $n->data,
            'read_at' => $n->read_at?->toIso8601String(),
            'created_at' => $n->created_at?->toIso8601String(),
        ]);

        $unread = $user->unreadNotifications()->count();

        return response()->json([
            'data' => $notifications,
            'unread' => $unread,
        ]);
    }

    /**
     * 标记单条通知已读（仅本人的）。
     */
    public function markRead(Request $request, string $id): JsonResponse
    {
        $user = $request->user();

        $notification = $user->notifications()->where('id', $id)->first();

        if ($notification === null) {
            abort(404);
        }

        if ($notification->read_at === null) {
            $notification->markAsRead();
        }

        return response()->json([
            'data' => ['unread' => $user->unreadNotifications()->count()],
        ]);
    }

    /**
     * 全部标为已读。
     */
    public function markAllRead(Request $request): JsonResponse
    {
        $request->user()->unreadNotifications->each->markAsRead();

        return response()->json(['data' => ['unread' => 0]]);
    }
}
