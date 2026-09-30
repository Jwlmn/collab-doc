<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Document;
use App\Models\Folder;
use App\Models\FolderDocument;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class FolderController extends Controller
{
    /**
     * 当前用户的文件夹列表（含归档数量，供筛选下拉展示）。
     */
    public function index(Request $request): JsonResponse
    {
        $folders = Folder::query()
            ->where('user_id', $request->user()->id)
            ->withCount('documents')
            ->orderBy('name')
            ->get();

        return response()->json(['data' => $folders]);
    }

    /**
     * 新建文件夹（名字在本人范围内唯一）。
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => [
                'required',
                'string',
                'max:50',
                Rule::unique('folders', 'name')->where('user_id', $request->user()->id),
            ],
        ]);

        $folder = $request->user()->folders()->create(['name' => $validated['name']]);

        return response()->json(['data' => $folder], 201);
    }

    /**
     * 重命名文件夹（仅本人；他人的 404 不暴露存在性）。
     */
    public function update(Request $request, Folder $folder): JsonResponse
    {
        abort_unless($folder->user_id === $request->user()->id, 404);

        $validated = $request->validate([
            'name' => [
                'required',
                'string',
                'max:50',
                Rule::unique('folders', 'name')
                    ->where('user_id', $request->user()->id)
                    ->ignore($folder->id),
            ],
        ]);

        $folder->update(['name' => $validated['name']]);

        return response()->json(['data' => $folder]);
    }

    /**
     * 删除文件夹（归属级联消失，文档回到未分类）。
     */
    public function destroy(Request $request, Folder $folder): JsonResponse
    {
        abort_unless($folder->user_id === $request->user()->id, 404);

        $folder->delete();

        return response()->json(['data' => null]);
    }

    /**
     * 把文档移入本人的某个文件夹（或 folder_id=null 移出）。
     * 视图权限即可：整理的是「我自己的」文档视图，不影响所有者。
     * 同一用户视角下一篇文档只在一个文件夹：先清该用户全部归属再写入。
     */
    public function attach(Request $request, Document $document): JsonResponse
    {
        $this->authorize('view', $document);

        $validated = $request->validate([
            'folder_id' => ['nullable', 'integer', Rule::exists('folders', 'id')->where('user_id', $request->user()->id)],
        ]);

        $user = $request->user();

        // 归属表没有 user 列（per-user 经 folders 间接），清理限定在本人的文件夹内
        $ownFolderIds = Folder::where('user_id', $user->id)->pluck('id');
        FolderDocument::whereIn('folder_id', $ownFolderIds)
            ->where('document_id', $document->id)
            ->delete();

        if (($validated['folder_id'] ?? null) !== null) {
            FolderDocument::create([
                'folder_id' => $validated['folder_id'],
                'document_id' => $document->id,
            ]);
        }

        $folderId = FolderDocument::whereIn('folder_id', $ownFolderIds)
            ->where('document_id', $document->id)
            ->value('folder_id');

        return response()->json(['data' => ['folder_id' => $folderId]]);
    }
}
