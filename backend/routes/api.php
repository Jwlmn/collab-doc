<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CollabTokenController;
use App\Http\Controllers\Api\CommentController;
use App\Http\Controllers\Api\DocumentController;
use App\Http\Controllers\Api\DocumentMemberController;
use App\Http\Controllers\Api\DocumentVersionController;
use App\Http\Controllers\Api\ImageController;
use App\Http\Controllers\Api\InviteController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\ShareLinkController;
use App\Http\Controllers\Api\UserController;
use Illuminate\Support\Facades\Route;

Route::post('/register', [AuthController::class, 'register'])->middleware('throttle:10,1');
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

// 图片读取公开（UUID 不可猜测，协作者/分享访客需无凭证访问）；上传须登录
Route::get('/images/{filename}', [ImageController::class, 'show'])
    ->where('filename', '[0-9a-f\-]+\.[a-z]+')
    ->middleware('throttle:120,1');

// 公开只读分享：GET-only（免 CSRF），失败一律 404 而非 401 ——
// 401 会让前端 request.ts 跳登录，把分享页劫持走
Route::get('/share/{token}', [ShareLinkController::class, 'resolve'])->middleware('throttle:30,1');
Route::get('/share/{token}/collab-token', [ShareLinkController::class, 'collabToken'])->middleware('throttle:10,1');

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/images', [ImageController::class, 'store'])->middleware('throttle:30,1');

    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/user', [AuthController::class, 'user']);

    Route::get('/users/search', [UserController::class, 'search']);

    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::post('/notifications/read-all', [NotificationController::class, 'markAllRead']);
    Route::post('/notifications/{id}/read', [NotificationController::class, 'markRead']);

    // 须在 apiResource 之前注册，避免被 /documents/{id} 绑定吞掉
    Route::get('/documents/search', [DocumentController::class, 'search']);
    Route::get('/documents/trashed', [DocumentController::class, 'trashed']);
    // 恢复/彻底删除按 id 手动查找（文档处于 trashed，不能走隐式绑定）
    Route::post('/documents/{document}/restore', [DocumentController::class, 'restore'])
        ->whereNumber('document');
    Route::delete('/documents/{document}/force', [DocumentController::class, 'forceDestroy'])
        ->whereNumber('document');

    Route::apiResource('documents', DocumentController::class);
    Route::post('/documents/{document}/collab-token', CollabTokenController::class);
    Route::post('/documents/{document}/invite-link', [InviteController::class, 'link']);
    // 公开只读分享链接（创建 / 撤销），仅所有者
    Route::post('/documents/{document}/share-link', [ShareLinkController::class, 'link']);
    Route::delete('/documents/{document}/share-link', [ShareLinkController::class, 'revoke']);
    // 令牌在路径中，无法用 {document} 绑定，放在 scopeBindings 之外
    Route::post('/invite/{token}', [InviteController::class, 'accept']);

    Route::scopeBindings()->group(function () {
        Route::apiResource('documents.versions', DocumentVersionController::class)
            ->only(['index', 'store', 'show', 'destroy']);

        Route::apiResource('documents.comments', CommentController::class)
            ->only(['index', 'store', 'destroy']);
        Route::get('documents/{document}/comments/unread', [CommentController::class, 'unread']);
        Route::post('documents/{document}/comments/read', [CommentController::class, 'markRead']);

        // 须在 {member} 绑定路由之前注册，避免被 members/{member} 吞掉
        Route::get('documents/{document}/members/search', [DocumentMemberController::class, 'searchInvitees']);
        Route::apiResource('documents.members', DocumentMemberController::class)
            ->only(['index', 'store', 'update', 'destroy']);
    });
});
