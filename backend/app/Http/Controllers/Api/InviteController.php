<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Document;
use App\Models\DocumentMember;
use App\Support\HmacToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class InviteController extends Controller
{
    /**
     * 生成文档邀请链接（仅所有者，无状态 HMAC 令牌）。
     */
    public function link(Request $request, Document $document): JsonResponse
    {
        $this->authorize('manage', $document);

        $token = HmacToken::issue('invite', (string) $document->id);

        return response()->json([
            'data' => [
                'token' => $token,
                'path' => '/invite/'.$token,
            ],
        ]);
    }

    /**
     * 接受邀请（需登录；默认加入为只读成员）。
     */
    public function accept(Request $request, string $token): JsonResponse
    {
        $documentId = self::verifyToken($token);

        if ($documentId === null) {
            abort(404, '邀请链接无效或已失效。');
        }

        $document = Document::find($documentId);

        if ($document === null) {
            abort(404, '邀请的文档不存在。');
        }

        $user = $request->user();

        if ($document->user_id === $user->id) {
            return response()->json([
                'data' => ['document_id' => $document->id, 'already' => true],
            ]);
        }

        $exists = $document->members()->where('user_id', $user->id)->exists();

        if ($exists) {
            return response()->json([
                'data' => ['document_id' => $document->id, 'already' => true],
            ]);
        }

        $document->members()->create([
            'user_id' => $user->id,
            'role' => DocumentMember::ROLE_VIEWER,
        ]);

        return response()->json([
            'data' => ['document_id' => $document->id, 'already' => false],
        ]);
    }

    /**
     * 校验邀请令牌，返回文档 id；无效返回 null。
     */
    private static function verifyToken(string $token): ?int
    {
        $decoded = HmacToken::verify('invite', $token);

        if ($decoded === null || ! ctype_digit($decoded)) {
            return null;
        }

        return (int) $decoded;
    }
}
