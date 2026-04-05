import { NextResponse } from "next/server";
import { z } from "zod";
import {
  withAuth,
  withManagerRole,
  validateRequestBody,
  type AuthenticatedRequest,
  type RouteContext,
} from "@/lib/api-handler";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

/** customer_id パスパラメータをパースして検証する共通ヘルパー */
function parseCustomerId(
  rawId: string
): { id: number; error: null } | { id: null; error: ReturnType<typeof ApiError.validationError> } {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return {
      id: null,
      error: ApiError.validationError([
        { field: "customer_id", message: "customer_id は正の整数で指定してください。" },
      ]),
    };
  }
  return { id, error: null };
}

const CustomerBodySchema = z.object({
  name: z.string().trim().min(1, "name は必須です。"),
  company_name: z.string().trim().min(1, "company_name は必須です。"),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().email("email の形式が正しくありません。").optional(),
  assigned_user_id: z.number().int().positive().optional(),
});

// ============================================================
// GET /customers/:customer_id
// ============================================================

export const GET = withAuth(async (_req: AuthenticatedRequest, ctx: RouteContext) => {
  const { customer_id } = await ctx.params;
  const parsed = parseCustomerId(customer_id);
  if (parsed.error) return parsed.error;
  const id = parsed.id;

  try {
    const customer = await prisma.customer.findUnique({
      where: { customerId: id },
      select: {
        customerId: true,
        name: true,
        companyName: true,
        address: true,
        phone: true,
        email: true,
        createdAt: true,
        updatedAt: true,
        assignedUser: {
          select: { userId: true, name: true },
        },
      },
    });

    if (!customer) {
      return ApiError.notFound("指定された顧客が存在しません。");
    }

    return NextResponse.json({
      data: {
        customer_id: customer.customerId,
        name: customer.name,
        company_name: customer.companyName,
        address: customer.address ?? null,
        phone: customer.phone ?? null,
        email: customer.email ?? null,
        assigned_user: customer.assignedUser
          ? { user_id: customer.assignedUser.userId, name: customer.assignedUser.name }
          : null,
        created_at: customer.createdAt.toISOString(),
        updated_at: customer.updatedAt.toISOString(),
      },
    });
  } catch {
    return ApiError.internal();
  }
});

// ============================================================
// PUT /customers/:customer_id
// ============================================================

export const PUT = withManagerRole(async (req: AuthenticatedRequest, ctx: RouteContext) => {
  const { customer_id } = await ctx.params;
  const parsed = parseCustomerId(customer_id);
  if (parsed.error) return parsed.error;
  const id = parsed.id;

  const validated = await validateRequestBody(req, CustomerBodySchema);
  if (validated.error) return validated.error;

  const { name, company_name, address, phone, email, assigned_user_id } = validated.data;

  try {
    // 顧客の存在確認
    const existing = await prisma.customer.findUnique({
      where: { customerId: id },
      select: { customerId: true },
    });
    if (!existing) {
      return ApiError.notFound("指定された顧客が存在しません。");
    }

    // assigned_user_id が指定された場合はユーザー存在確認
    if (assigned_user_id !== undefined) {
      const user = await prisma.user.findUnique({
        where: { userId: assigned_user_id, deletedAt: null },
        select: { userId: true },
      });
      if (!user) {
        return ApiError.validationError([
          { field: "assigned_user_id", message: "指定されたユーザーが存在しません。" },
        ]);
      }
    }

    await prisma.customer.update({
      where: { customerId: id },
      data: {
        name,
        companyName: company_name,
        address: address ?? null,
        phone: phone ?? null,
        email: email ?? null,
        // assigned_user_id が未指定の場合は null にセット（フル更新）
        assignedUserId: assigned_user_id ?? null,
      },
    });

    return NextResponse.json({ data: { customer_id: id } });
  } catch {
    return ApiError.internal();
  }
});

// ============================================================
// DELETE /customers/:customer_id
// ============================================================

export const DELETE = withManagerRole(async (_req: AuthenticatedRequest, ctx: RouteContext) => {
  const { customer_id } = await ctx.params;
  const parsed = parseCustomerId(customer_id);
  if (parsed.error) return parsed.error;
  const id = parsed.id;

  try {
    const existing = await prisma.customer.findUnique({
      where: { customerId: id },
      select: { customerId: true },
    });
    if (!existing) {
      return ApiError.notFound("指定された顧客が存在しません。");
    }

    await prisma.customer.delete({ where: { customerId: id } });

    return new NextResponse(null, { status: 204 });
  } catch {
    return ApiError.internal();
  }
});
