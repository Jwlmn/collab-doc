<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CollabTokenController;
use App\Http\Controllers\Api\CommentController;
use App\Http\Controllers\Api\DocumentController;
use App\Http\Controllers\Api\DocumentMemberController;
use App\Http\Controllers\Api\DocumentVersionController;
use App\Http\Controllers\Api\InviteController;
use App\Http\Controllers\Api\UserController;
use Illuminate\Support\Facades\Route;

Route::post('/register', [AuthController::class, 'register'])->middleware('throttle:10,1');
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/user', [AuthController::class, 'user']);

    Route::get('/users/search', [UserController::class, 'search']);

    // 须在 apiResource 之前注册，避免被 /documents/{id} 绑定吞掉
    Route::get('/documents/search', [DocumentController::class, 'search']);

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

        Route::apiResource('documents.members', DocumentMemberController::class)
            ->only(['index', 'store', 'update', 'destroy']);
    });
});
