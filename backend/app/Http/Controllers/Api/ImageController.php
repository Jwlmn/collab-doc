<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Document;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\Mime\MimeTypes;

class ImageController extends Controller
{
    /** 允许的图片扩展名（与 mimes 校验保持一致） */
    private const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

    /**
     * 上传图片，返回编辑器可直接引用的相对 URL。
     *
     * 存储在 private 盘、经 /api/images 提供访问 —— 这样开发（Vite 只代理 /api）
     * 与生产（nginx 已反代 /api）都不需要额外配置；用相对路径则 APP_URL 变更
     * 不会影响存量图片。
     */
    public function store(Request $request): JsonResponse
    {
        $this->authorize('create', Document::class);

        $validated = $request->validate([
            'file' => ['required', 'file', 'mimes:jpg,jpeg,png,gif,webp', 'max:5120'],
        ]);

        $file = $request->file('file');
        $extension = strtolower($file->getClientOriginalExtension());
        $filename = Str::uuid()->toString().'.'.$extension;

        Storage::disk('local')->put('images/'.$filename, (string) file_get_contents($file->getRealPath()));

        return response()->json([
            'data' => [
                'url' => '/api/images/'.$filename,
                'filename' => $filename,
                'size' => $file->getSize(),
            ],
        ], 201);
    }

    /**
     * 提供已上传图片（公开读：URL 含不可猜测的 UUID，且协作者需要无凭证访问）。
     */
    public function show(string $filename): Response
    {
        abort_unless($this->isValidFilename($filename), 404);

        abort_unless(Storage::disk('local')->exists('images/'.$filename), 404);

        $mime = MimeTypes::getDefault()->getMimeTypes(pathinfo($filename, PATHINFO_EXTENSION))[0] ?? 'application/octet-stream';

        return response(
            Storage::disk('local')->get('images/'.$filename),
            200,
            [
                'Content-Type' => $mime,
                'Cache-Control' => 'public, max-age=31536000, immutable',
            ]
        );
    }

    /**
     * 文件名白名单：UUID + 合法扩展名，杜绝路径穿越。
     */
    private function isValidFilename(string $filename): bool
    {
        if (! preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]+$/', $filename)) {
            return false;
        }

        $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));

        return in_array($extension, self::ALLOWED_EXTENSIONS, true);
    }
}
