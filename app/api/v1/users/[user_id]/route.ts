import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  withManagerRole,
  validateRequestBody,
  type AuthenticatedRequest,
  type RouteContext,
} from "@/lib/api-handler";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

/** user_id パスパラメータをパースして検証する共通ヘルパー */
function parseUserId(
  rawId: string
): { id: number; error: null } | { id: null; error: ReturnType<typeof ApiError.validationError> } {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return {
      id: null,
      error: ApiError.validationError([
        { field: "user_id", message: "user_id は正の整数で指定してください。" },
      ]),
    };
  }
  return { id, error: null };
}

// ============================================================
// GET /users/:user_id
// ============================================================

export const GET = withManagerRole(async (_req: AuthenticatedRequest, ctx: RouteContext) => {
  const { user_id } = await ctx.params;
  const parsed = parseUserId(user_id);
  if (parsed.error) return parsed.error;
  const id = parsed.id;

  try {
    const user = await prisma.user.findUnique({
      where: { userId: id, deletedAt: null },
      select: {
        userId: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        manager: {
          select: { userId: true, name: true },
        },
      },
    });

    if (!user) {
      return ApiError.notFound("指定されたユーザーが存在しません。");
    }

    return NextResponse.json({
      data: {
        user_id: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
        manager: user.manager
          ? { user_id: user.manager.userId, name: user.manager.name }
          : null,
        created_at: user.createdAt.toISOString(),
        updated_at: user.updatedAt.toISOString(),
      },
    });
  } catch {
    return ApiError.internal();
  }
});

// ============================================================
// PUT /users/:user_id
// ============================================================

const UpdateUserBodySchema = z
  .object({
    name: z.string().trim().min(1, "name は必須です。"),
    email: z.string().email("email の形式が正しくありません。"),
    password: z.string().min(8, "password は8文字以上で入力してください。").optional(),
    role: z.enum(["sales", "manager"], { error: "role は必須です。" }),
    manager_id: z.number().int().positive().optional(),
  })
  .refine(
    (data) => {
      if (data.role === "sales" && data.manager_id === undefined) {
        return false;
      }
      return true;
    },
    { message: "role が sales の場合、manager_id は必須です。", path: ["manager_id"] }
  );

export const PUT = withManagerRole(async (req: AuthenticatedRequest, ctx: RouteContext) => {
  const { user_id } = await ctx.params;
  const parsed = parseUserId(user_id);
  if (parsed.error) return parsed.error;
  const id = parsed.id;

  const validated = await validateRequestBody(req, UpdateUserBodySchema);
  if (validated.error) return validated.error;

  const { name, email, password, role, manager_id } = validated.data;

  try {
    // ユーザーの存在確認
    const existing = await prisma.user.findUnique({
      where: { userId: id, deletedAt: null },
      select: { userId: true },
    });
    if (!existing) {
      return ApiError.notFound("指定されたユーザーが存在しません。");
    }

    // manager_id が指定された場合は上長の存在確認 + manager ロールであることを確認
    if (manager_id !== undefined) {
      const manager = await prisma.user.findUnique({
        where: { userId: manager_id, deletedAt: null, role: "manager" },
        select: { userId: true },
      });
      if (!manager) {
        return ApiError.validationError([
          { field: "manager_id", message: "指定された上長ユーザーが存在しません。" },
        ]);
      }
    }

    // パスワードが指定された場合のみハッシュ化してupdateデータに含める
    const updateData: Prisma.UserUpdateInput = {
      name,
      email,
      role,
      manager: manager_id != null ? { connect: { userId: manager_id } } : { disconnect: true },
    };

    if (password !== undefined) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    await prisma.user.update({
      where: { userId: id },
      data: updateData,
    });

    return NextResponse.json({ data: { user_id: id } });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return ApiError.validationError([
        { field: "email", message: "このメールアドレスは既に使用されています。" },
      ]);
    }
    return ApiError.internal();
  }
});

// ============================================================
// DELETE /users/:user_id
// ============================================================

export const DELETE = withManagerRole(async (req: AuthenticatedRequest, ctx: RouteContext) => {
  const { user_id } = await ctx.params;
  const parsed = parseUserId(user_id);
  if (parsed.error) return parsed.error;
  const id = parsed.id;

  // 自分自身の削除禁止
  if (req.user.user_id === id) {
    return ApiError.cannotDeleteSelf();
  }

  try {
    const existing = await prisma.user.findUnique({
      where: { userId: id, deletedAt: null },
      select: { userId: true },
    });
    if (!existing) {
      return ApiError.notFound("指定されたユーザーが存在しません。");
    }

    await prisma.user.update({
      where: { userId: id },
      data: { deletedAt: new Date() },
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    return ApiError.internal();
  }
});
