import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { validateRequestBody } from "@/lib/api-handler";
import { signJwt } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const LoginSchema = z.object({
  email: z.string().email("メールアドレスの形式が正しくありません。"),
  password: z.string().min(1, "パスワードは必須です。"),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const validated = await validateRequestBody(req, LoginSchema);
  if (validated.error) {
    return validated.error;
  }

  const { email, password } = validated.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      userId: true,
      name: true,
      email: true,
      role: true,
      passwordHash: true,
      deletedAt: true,
    },
  });

  // 存在しない、論理削除済み、またはパスワード不一致はすべて同じエラーを返す
  if (!user || user.deletedAt !== null) {
    return ApiError.invalidCredentials();
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) {
    return ApiError.invalidCredentials();
  }

  const token = await signJwt({
    user_id: user.userId,
    email: user.email,
    role: user.role,
  });

  return NextResponse.json({
    data: {
      token,
      user: {
        user_id: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    },
  });
}
