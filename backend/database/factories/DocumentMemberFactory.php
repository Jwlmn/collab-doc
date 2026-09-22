<?php

namespace Database\Factories;

use App\Models\Document;
use App\Models\DocumentMember;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DocumentMember>
 */
class DocumentMemberFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'document_id' => Document::factory(),
            'user_id' => User::factory(),
            'role' => DocumentMember::ROLE_VIEWER,
        ];
    }
}
