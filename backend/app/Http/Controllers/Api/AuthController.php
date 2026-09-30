<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\LoginRequest;
use App\Http\Requests\RegisterRequest;
use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    /**
     * 注册并自动登录。
     */
    public function register(RegisterRequest $request): JsonResponse
    {
        $user = $request->createUser();

        Auth::login($user);

        $request->session()->regenerate();

        return (new UserResource($user))->response()->setStatusCode(201);
    }

    /**
     * 登录。
     */
    public function login(LoginRequest $request): JsonResponse
    {
        if (! Auth::attempt($request->credentials(), $request->boolean('remember'))) {
            throw ValidationException::withMessages([
                'email' => 'These credentials do not match our records.',
            ]);
        }

        $request->session()->regenerate();

        return (new UserResource($request->user()))->response();
    }

    /**
     * 登出。
     */
    public function logout(Request $request): Response
    {
        Auth::guard('web')->logout();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->noContent();
    }

    /**
     * 当前登录用户。
     */
    public function user(Request $request): UserResource
    {
        return new UserResource($request->user());
    }

    /**
     * 更新个人资料（昵称 / 头像）。
     */
    public function update(Request $request): UserResource
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            // 头像必须指向本服务的图片上传产物，拒绝外链（防追踪像素/混合内容）
            'avatar_url' => [
                'nullable',
                'string',
                'max:120',
                'regex:^/api/images/[A-Za-z0-9._-]+\.(jpg|jpeg|png|gif|webp)$^',
            ],
        ]);

        $request->user()->update($validated);

        return new UserResource($request->user());
    }

    /**
     * 修改密码（校验当前密码；成功后会话保持，其余令牌不动）。
     */
    public function updatePassword(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'current_password' => ['required', 'current_password'],
            'password' => ['required', 'string', 'confirmed', Password::defaults()],
        ]);

        $request->user()->update([
            'password' => Hash::make($validated['password']),
        ]);

        return response()->json(['message' => '密码已更新。']);
    }
}
