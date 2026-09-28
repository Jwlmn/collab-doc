<?php

namespace App\Support;

/**
 * 无状态 HMAC 令牌（base64url 载荷 . base64url 签名）。
 *
 * 用途前缀（`invite:` / `share:` / …）参与签名，防止跨用途重放 ——
 * 一枚邀请令牌不能被当成分享令牌使用。协作服务器侧的令牌不走这里
 * （它有独立的 payload 结构与校验，见 server/src/index.ts）。
 *
 * 同时提供原始载荷与 JSON 载荷两组 API：邀请令牌历史上用的是裸字符串
 * 载荷，保持原格式以免已发出的链接失效；分享令牌需要结构化字段，用 JSON。
 */
final class HmacToken
{
    /**
     * 以原始字符串载荷签发令牌。
     */
    public static function issue(string $purpose, string $payload): string
    {
        $encoded = self::base64UrlEncode($payload);

        return $encoded.'.'.self::sign($purpose, $encoded);
    }

    /**
     * 校验原始字符串载荷令牌；签名不符返回 null。
     */
    public static function verify(string $purpose, string $token): ?string
    {
        $encoded = self::extract($purpose, $token);

        if ($encoded === null) {
            return null;
        }

        $decoded = base64_decode(strtr($encoded, '-_', '+/'), true);

        return $decoded === false ? null : $decoded;
    }

    /**
     * 以 JSON 载荷签发令牌。
     *
     * @param  array<string, mixed>  $payload
     */
    public static function issueJson(string $purpose, array $payload): string
    {
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        return self::issue($purpose, $json === false ? '' : $json);
    }

    /**
     * 校验 JSON 载荷令牌；签名不符或非数组载荷返回 null。
     *
     * 过期、版本号等业务校验交给调用方 —— 这里只管密码学完整性。
     *
     * @return array<string, mixed>|null
     */
    public static function verifyJson(string $purpose, string $token): ?array
    {
        $raw = self::verify($purpose, $token);

        if ($raw === null) {
            return null;
        }

        $decoded = json_decode($raw, true);

        return is_array($decoded) ? $decoded : null;
    }

    /** 签名校验通过则返回 base64url 编码的载荷，否则 null */
    private static function extract(string $purpose, string $token): ?string
    {
        $parts = explode('.', $token);

        if (count($parts) !== 2) {
            return null;
        }

        [$encoded, $signature] = $parts;

        return hash_equals(self::sign($purpose, $encoded), $signature) ? $encoded : null;
    }

    private static function sign(string $purpose, string $encoded): string
    {
        return self::base64UrlEncode(
            hash_hmac('sha256', $purpose.':'.$encoded, config('collab.secret'), true)
        );
    }

    private static function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
