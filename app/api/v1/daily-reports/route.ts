import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  validateQueryParams,
  withAuth,
  type AuthenticatedRequest,
} from "@/lib/api-handler";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const QuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "from は YYYY-MM-DD 形式で入力してください。")
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "to は YYYY-MM-DD 形式で入力してください。")
    .optional(),
  user_id: z.coerce.number().int().positive().optional(),
  status: z.enum(["draft", "submitted"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

/** 当月初日と今日の日付文字列（YYYY-MM-DD）を返す */
function getDefaultDates(): { from: string; to: string } {
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${d}` };
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const validated = validateQueryParams(req, QuerySchema);
  if (validated.error) return validated.error;

  const { user_id: queryUserId, status, page, per_page } = validated.data;
  const defaults = getDefaultDates();
  const from = validated.data.from ?? defaults.from;
  const to = validated.data.to ?? defaults.to;

  const { user_id: currentUserId, role } = req.user;
  const skip = (page - 1) * per_page;

  const where: Prisma.DailyReportWhereInput = {
    reportDate: {
      gte: new Date(from),
      lte: new Date(to),
    },
  };

  if (status) {
    where.status = status;
  }

  try {
    if (role === "sales") {
      // salesは自分の日報のみ取得。他ユーザー指定は 403
      if (queryUserId !== undefined && queryUserId !== currentUserId) {
        return ApiError.forbidden();
      }
      where.userId = currentUserId;
    } else {
      // manager: 部下全員の日報を取得
      const subordinates = await prisma.user.findMany({
        where: { managerId: currentUserId, deletedAt: null },
        select: { userId: true },
      });
      const subordinateIds = subordinates.map((u) => u.userId);

      if (queryUserId !== undefined) {
        // 指定した user_id が部下でなければ 403
        if (!subordinateIds.includes(queryUserId)) {
          return ApiError.forbidden();
        }
        where.userId = queryUserId;
      } else {
        where.userId = { in: subordinateIds };
      }
    }

    const [total, reports] = await Promise.all([
      prisma.dailyReport.count({ where }),
      prisma.dailyReport.findMany({
        where,
        include: {
          user: { select: { userId: true, name: true } },
          _count: { select: { visitRecords: true } },
        },
        orderBy: [{ reportDate: "desc" }, { reportId: "desc" }],
        skip,
        take: per_page,
      }),
    ]);

    const reportIds = reports.map((r) => r.reportId);
    const commentCounts = await getCommentCounts(reportIds);

    const data = reports.map((r) => ({
      report_id: r.reportId,
      report_date: r.reportDate.toISOString().split("T")[0],
      status: r.status,
      submitted_at: r.submittedAt?.toISOString() ?? null,
      user: { user_id: r.user.userId, name: r.user.name },
      visit_count: r._count.visitRecords,
      comment_count: commentCounts.get(r.reportId) ?? 0,
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

/**
 * 指定した日報IDに紐づく Problem・Plan のコメント数を集計する。
 * polymorphic な comments テーブルに対して raw SQL を使用する。
 */
async function getCommentCounts(
  reportIds: number[]
): Promise<Map<number, number>> {
  if (reportIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<
    Array<{ report_id: bigint; count: bigint }>
  >`
    SELECT sub.report_id, COUNT(c.comment_id) AS count
    FROM (
      SELECT p.report_id, p.problem_id AS target_id, 'problem'::text AS target_type
      FROM problems p
      WHERE p.report_id IN (${Prisma.join(reportIds)})
      UNION ALL
      SELECT pl.report_id, pl.plan_id AS target_id, 'plan'::text AS target_type
      FROM plans pl
      WHERE pl.report_id IN (${Prisma.join(reportIds)})
    ) sub
    JOIN comments c ON c.target_type::text = sub.target_type
      AND c.target_id = sub.target_id
    GROUP BY sub.report_id
  `;

  return new Map(rows.map((r) => [Number(r.report_id), Number(r.count)]));
}
