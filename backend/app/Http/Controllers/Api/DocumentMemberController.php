<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\DocumentMemberResource;
use App\Models\Document;
use App\Models\DocumentMember;
use App\Models\User;
use App\Notifications\DocumentSharedNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

class DocumentMemberController extends Controller
{
    /**
     * 文档成员列表（任意成员可见）。
     */
    public function index(Document $document): AnonymousResourceCollection
    {
        $this->authorize('view', $document);

        $members = $document->members()->with('user:id,name,email')->orderBy('id')->get();

        return DocumentMemberResource::collection($members);
    }

    /**
     * 添加成员（仅所有者）。
     */
    public function store(Request $request, Document $document): JsonResponse
    {
        $this->authorize('manage', $document);

        $validated = $request->validate([
            'email' => ['required', 'string', 'email'],
            'role' => ['required', Rule::in(DocumentMember::roles())],
        ]);

        $user = User::where('email', $validated['email'])->first();

        if ($user === null) {
            return response()->json([
                'message' => '该邮箱尚未注册。',
            ], 422);
        }

        if ($user->id === $document->user_id) {
            return response()->json([
                'message' => '该用户已是文档所有者。',
            ], 422);
        }

        if ($document->members()->where('user_id', $user->id)->exists()) {
            return response()->json([
                'message' => '该用户已是文档成员。',
            ], 422);
        }

        $member = $document->members()->create([
            'user_id' => $user->id,
            'role' => $validated['role'],
        ]);

        // 站内通知：文档被共享给该用户
        $user->notify(new DocumentSharedNotification($document, $member));

        return (new DocumentMemberResource($member->load('user:id,name,email')))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * 修改成员角色（仅所有者）。
     */
    public function update(Request $request, Document $document, DocumentMember $member): DocumentMemberResource
    {
        $this->authorize('manage', $document);

        $validated = $request->validate([
            'role' => ['required', Rule::in(DocumentMember::roles())],
        ]);

        $member->update($validated);

        return new DocumentMemberResource($member->load('user:id,name,email'));
    }

    /**
     * 移除成员（仅所有者）。
     */
    public function destroy(Document $document, DocumentMember $member): Response
    {
        $this->authorize('manage', $document);

        $member->delete();

        return response()->noContent();
    }
}
