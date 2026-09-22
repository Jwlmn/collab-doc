<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserController extends Controller
{
    /**
     * 按名称搜索用户（供 @提及 选择），仅返回 id 与 name。
     */
    public function search(Request $request): JsonResponse
    {
        $query = mb_strtolower(trim((string) $request->query('q', '')));

        $users = User::query()
            ->when($query !== '', function ($builder) use ($query) {
                $builder->whereRaw('LOWER(name) LIKE ?', ['%'.$query.'%']);
            })
            ->orderBy('name')
            ->limit(10)
            ->get(['id', 'name']);

        return response()->json(['data' => $users]);
    }
}
