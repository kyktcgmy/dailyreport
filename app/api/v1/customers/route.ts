export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  validateQueryParams,
  validateRequestBody,
  withAuth,
  withManagerRole,
  type AuthenticatedRequest,
} from "@/lib/api-handler";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

// ============================================================
// GET /customers
// ============================================================

const ListQuerySchema = z.object({
  name: z.string().optional(),
  company_name: z.string().optional(),
  assigned_user_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const validated = validateQueryParams(req, ListQuerySchema);
  if (validated.error) return validated.error;

  const { name, company_name, assigned_user_id, page, per_page } = validated.data;
  const skip = (page - 1) * per_page;

  const where: Prisma.CustomerWhereInput = {};

  if (name) {
    where.name = { contains: name };
  }
  if (company_name) {
    where.companyName = { contains: company_name };
  }
  if (assigned_user_id !== undefined) {
    where.assignedUserId = assigned_user_id;
  }

  try {
    const [total, customers] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        select: {
          customerId: true,
          name: true,
          companyName: true,
          phone: true,
          email: true,
          assignedUser: {
            select: { userId: true, name: true },
          },
        },
        orderBy: { customerId: "asc" },
        skip,
        take: per_page,
      }),
    ]);

    const data = customers.map((c) => ({
      customer_id: c.customerId,
      name: c.name,
      company_name: c.companyName,
      phone: c.phone ?? null,
      email: c.email ?? null,
      assigned_user: c.assignedUser
        ? { user_id: c.assignedUser.userId, name: c.assignedUser.name }
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
// POST /customers
// ============================================================

const CustomerBodySchema = z.object({
  name: z.string().trim().min(1, "name は必須です。"),
  company_name: z.string().trim().min(1, "company_name は必須です。"),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().email("email の形式が正しくありません。").optional(),
  assigned_user_id: z.number().int().positive().optional(),
});

export const POST = withManagerRole(async (req: AuthenticatedRequest) => {
  const validated = await validateRequestBody(req, CustomerBodySchema);
  if (validated.error) return validated.error;

  const { name, company_name, address, phone, email, assigned_user_id } = validated.data;

  try {
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

    const customer = await prisma.customer.create({
      data: {
        name,
        companyName: company_name,
        address: address ?? null,
        phone: phone ?? null,
        email: email ?? null,
        assignedUserId: assigned_user_id ?? null,
      },
      select: { customerId: true },
    });

    return NextResponse.json({ data: { customer_id: customer.customerId } }, { status: 201 });
  } catch {
    return ApiError.internal();
  }
});
