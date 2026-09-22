<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Document;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CollabTokenController extends Controller
{
    /**
     * 签发协作服务器（HocusPocus）连接令牌。
     *
     * 令牌为 HMAC-SHA256 签名的 base64url 载荷，包含文档名、用户 ID、
     * 角色与过期时间；协作服务器用共享密钥独立校验。
     */
    public function __invoke(Request $request, Document $document): JsonResponse
    {
        $this->authorize('view', $document);

        $user = $request->user();
        $role = $user->id === $document->user_id
            ? 'owner'
            : $document->members()->where('user_id', $user->id)->value('role');

        $expiresAt = now()->addHours(4)->getTimestamp();

        $payload = json_encode([
            'document' => 'doc-'.$document->id,
            'uid' => $user->id,
            'role' => $role,
            'exp' => $expiresAt,
        ], JSON_UNESCAPED_UNICODE);

        $encoded = self::base64UrlEncode($payload);
        $signature = self::base64UrlEncode(
            hash_hmac('sha256', $encoded, config('collab.secret'), true)
        );

        return response()->json([
            'data' => [
                'token' => $encoded.'.'.$signature,
                'role' => $role,
                'expires_at' => $expiresAt,
            ],
        ]);
    }

    private static function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
