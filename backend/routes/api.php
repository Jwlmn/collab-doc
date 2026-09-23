<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CollabTokenController;
use App\Http\Controllers\Api\CommentController;
use App\Http\Controllers\Api\DocumentController;
use App\Http\Controllers\Api\DocumentMemberController;
use App\Http\Controllers\Api\DocumentVersionController;
use App\Http\Controllers\Api\InviteController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\UserController;
use Illuminate\Support\Facades\Route;

Route::post('/register', [AuthController::class, 'register'])->middleware('throttle:10,1');
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

Route::middleware('auth:sanctum')->group(function () {
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
