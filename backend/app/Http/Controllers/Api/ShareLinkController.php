<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Document;
use App\Support\HmacToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * 公开只读分享链接。
 *
 * 设计要点：
 * - 令牌无状态（HMAC），有效期写进令牌本身，`exp=0` 表示永不过期
 * - 撤销靠 `documents.share_version++`：验签时要求令牌里的 v 等于当前版本，
 *   该文档所有在外链接立即失效（纯 HMAC 撤不了单条，需要单条撤销时再建表）
 * - 访客端点全部在 auth:sanctum 之外且**只读**，失败一律 404 而非 401
 *   （401 会触发前端 request.ts 跳登录，把分享页劫持到登录页）
 * - 访客拿的是 `role=viewer` / `uid=0` 的协作令牌：协作服务器对 viewer
 *   强制只读（server/src/index.ts onAuthenticate），服务端兜底
 */
class ShareLinkController extends Controller
{
    /** 令牌用途前缀，参与签名防跨用途重放 */
    private const PURPOSE = 'share';

    /**
     * 创建（或重新签发）公开分享链接 —— 仅所有者。
     */
    public function link(Request $request, Document $document): JsonResponse
    {
        $this->authorize('manage', $document);

        $validated = $request->validate([
            'expires_in_days' => ['nullable', 'integer', 'min:1', 'max:365'],
        ]);

        $days = $validated['expires_in_days'] ?? null;
        $expiresAt = $days === null ? 0 : now()->addDays($days)->getTimestamp();

        $token = HmacToken::issueJson(self::PURPOSE, [
            'd' => $document->id,
            'exp' => $expiresAt,
            'v' => $document->share_version ?? 0,
        ]);

        return response()->json([
            'data' => [
                'token' => $token,
                'path' => '/share/'.$token,
                // 0 = 永不过期
                'expires_at' => $expiresAt === 0 ? null : date(DATE_ATOM, $expiresAt),
            ],
        ]);
    }

    /**
     * 撤销该文档的全部公开分享链接 —— 仅所有者。
     */
    public function revoke(Document $document): Response
    {
        $this->authorize('manage', $document);

        // share_version 不在 fillable 里，用 query builder 直接自增避免 mass-assignment 限制
        Document::whereKey($document->id)->increment('share_version');

        return response()->noContent();
    }

    /**
     * 访客解析分享链接 → 文档元数据（最小披露：不返回成员/邮箱）。
     */
    public function resolve(string $token): JsonResponse
    {
        $document = $this->documentFromToken($token);

        return response()->json([
            'data' => [
                'document' => [
                    'id' => $document->id,
                    'user_id' => $document->user_id,
                    'title' => $document->title,
                    'type' => $document->type ?? 'md',
                    // 驱动前端只读态：isReadonly = role === 'viewer'
                    'role' => 'viewer',
                    'owner' => [
                        'id' => $document->user?->id,
                        'name' => $document->user?->name,
                    ],
                    'created_at' => $document->created_at?->toIso8601String(),
                ],
                'expires_at' => $this->expiresAt($token),
            ],
        ]);
    }

    /**
     * 访客签发协作令牌（viewer 只读、uid=0）。
     *
     * 独立于 POST /documents/{id}/collab-token —— 后者仍留在 auth:sanctum 内，
     * CollabTokenTest::test_guest_cannot_get_collab_token 保持不变。
     */
    public function collabToken(string $token): JsonResponse
    {
        $document = $this->documentFromToken($token);
        $shareExp = $this->expiresAt($token);

        // 协作令牌 4 小时；分享若更早过期则以分享为准
        $localExp = now()->addHours(4)->getTimestamp();
        $expiresAt = $shareExp === 0 ? $localExp : min($localExp, $shareExp);

        $payload = json_encode([
            'document' => 'doc-'.$document->id,
            'uid' => 0,
            'role' => 'viewer',
            'exp' => $expiresAt,
        ], JSON_UNESCAPED_UNICODE);

        $encoded = rtrim(strtr(base64_encode($payload), '+/', '-_'), '=');
        $signature = rtrim(
            strtr(base64_encode(hash_hmac('sha256', $encoded, config('collab.secret'), true)), '+/', '-_'),
            '='
        );

        return response()->json([
            'data' => [
                'token' => $encoded.'.'.$signature,
                'role' => 'viewer',
                'expires_at' => $expiresAt,
            ],
        ]);
    }

    /**
     * 验签 + 过期 + 撤销 + 回收站检查，通过则返回文档。
     * 任何失败一律 404（绝不 401 —— 见类注释）。
     */
    private function documentFromToken(string $token): Document
    {
        $payload = HmacToken::verifyJson(self::PURPOSE, $token);

        abort_if($payload === null, 404, '链接无效或已失效');

        $documentId = $payload['d'] ?? null;
        $version = $payload['v'] ?? null;
        $exp = $payload['exp'] ?? 0;

        abort_unless(is_int($documentId) && is_int($version), 404, '链接无效或已失效');

        // 令牌已过期（exp=0 表示永不过期）
        if ($exp !== 0 && $exp < time()) {
            abort(404, '链接无效或已失效');
        }

        $document = Document::with('user:id,name')->find($documentId);

        // 文档不存在 / 在回收站 / 已被撤销（版本号对不上）
        abort_if(
            $document === null || $document->share_version !== $version,
            404,
            '链接无效或已失效'
        );

        return $document;
    }

    /** 令牌里的过期时间戳；0 表示永不过期 */
    private function expiresAt(string $token): int
    {
        $payload = HmacToken::verifyJson(self::PURPOSE, $token);

        return is_int($payload['exp'] ?? null) ? (int) $payload['exp'] : 0;
    }
}
