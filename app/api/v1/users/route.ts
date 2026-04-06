import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  validateQueryParams,
  validateRequestBody,
  withManagerRole,
  type AuthenticatedRequest,
} from "@/lib/api-handler";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

// ============================================================
// GET /users
// ============================================================

const ListQuerySchema = z.object({
  role: z.enum(["sales", "manager"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = withManagerRole(async (req: AuthenticatedRequest) => {
  const validated = validateQueryParams(req, ListQuerySchema);
  if (validated.error) return validated.error;

  const { role, page, per_page } = validated.data;
  const skip = (page - 1) * per_page;

  const where: Prisma.UserWhereInput = { deletedAt: null };

  if (role) {
    where.role = role;
  }

  try {
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          userId: true,
          name: true,
          email: true,
          role: true,
          manager: {
            select: { userId: true, name: true },
          },
        },
        orderBy: { userId: "asc" },
        skip,
        take: per_page,
      }),
    ]);

    const data = users.map((u) => ({
      user_id: u.userId,
      name: u.name,
      email: u.email,
      role: u.role,
      manager: u.manager
        ? { user_id: u.manager.userId, name: u.manager.name }
        : null,
    }));

    return NextResponse.json({
      data,
      pagination: {
        total,
        page,
        per_page,
        total_pages: Math.ceil(total / per_page),
      },
    });
  } catch {
    return ApiError.internal();
  }
});

// ============================================================
// POST /users
// ============================================================

const CreateUserBodySchema = z
  .object({
    name: z.string().trim().min(1, "name は必須です。"),
    email: z.string().email("email の形式が正しくありません。"),
    password: z.string().min(8, "password は8文字以上で入力してください。"),
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

export const POST = withManagerRole(async (req: AuthenticatedRequest) => {
  const validated = await validateRequestBody(req, CreateUserBodySchema);
  if (validated.error) return validated.error;

  const { name, email, password, role, manager_id } = validated.data;

  try {
    // manager_id が指定された場合はユーザー存在確認 + manager ロールであることを確認
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

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role,
        manager: manager_id != null ? { connect: { userId: manager_id } } : undefined,
      },
      select: { userId: true },
    });

    return NextResponse.json({ data: { user_id: user.userId } }, { status: 201 });
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
