import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  validateQueryParams,
  validateRequestBody,
  withAuth,
  withSalesRole,
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

/** 当月初日と今日の日付文字列（YYYY-MM-DD）を JST 基準で返す */
function getDefaultDates(): { from: string; to: string } {
  // JST (UTC+9) オフセットを加算して「今日の JST 日付」を求める
  const jstDate = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = jstDate.getUTCFullYear();
  const m = String(jstDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jstDate.getUTCDate()).padStart(2, "0");
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
      // manager: 自分自身 + 部下全員の日報を取得
      const subordinates = await prisma.user.findMany({
        where: { managerId: currentUserId, deletedAt: null },
        select: { userId: true },
      });
      // manager 自身も閲覧対象に含める
      const accessibleIds = [
        currentUserId,
        ...subordinates.map((u) => u.userId),
      ];

      if (queryUserId !== undefined) {
        // 指定した user_id が自分または部下でなければ 403
        if (!accessibleIds.includes(queryUserId)) {
          return ApiError.forbidden();
        }
        where.userId = queryUserId;
      } else {
        where.userId = { in: accessibleIds };
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

// ============================================================
// POST /daily-reports
// ============================================================

const VisitRecordInputSchema = z.object({
  customer_id: z.number({ required_error: "customer_id は必須です。" }).int().positive(),
  // [要修正-2] 有効な時刻範囲（00:00〜23:59）のみ受け付ける
  visited_at: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "visited_at は HH:MM 形式（00:00〜23:59）で入力してください。"),
  visit_content: z.string().min(1, "visit_content は必須です。"),
  attendee_user_ids: z.array(z.number().int().positive()).default([]),
});

const ProblemInputSchema = z.object({
  content: z.string().min(1, "content は必須です。"),
  sort_order: z.number().int().min(1),
});

const PlanInputSchema = z.object({
  content: z.string().min(1, "content は必須です。"),
  sort_order: z.number().int().min(1),
});

const CreateDailyReportSchema = z.object({
  // [要修正-1] フォーマットに加えて実在する日付であることを検証する
  report_date: z
    .string({ required_error: "report_date は必須です。" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "report_date は YYYY-MM-DD 形式で入力してください。")
    .refine(
      (val) => !isNaN(new Date(`${val}T00:00:00.000Z`).getTime()),
      "report_date に存在しない日付が指定されています。"
    ),
  status: z.enum(["draft", "submitted"]).default("draft"),
  visit_records: z.array(VisitRecordInputSchema).default([]),
  problems: z.array(ProblemInputSchema).default([]),
  plans: z.array(PlanInputSchema).default([]),
});

/** 重複日報を示すセンチネルエラー（transaction 内から外側へ伝播させるために使用） */
class DuplicateReportError extends Error {}

export const POST = withSalesRole(async (req: AuthenticatedRequest) => {
  const validated = await validateRequestBody(req, CreateDailyReportSchema);
  if (validated.error) return validated.error;

  const { report_date, status, visit_records, problems, plans } = validated.data;
  const { user_id: currentUserId } = req.user;

  const reportDate = new Date(`${report_date}T00:00:00.000Z`);

  try {
    const newReport = await prisma.$transaction(async (tx) => {
      // 同一ユーザー・同一日付の重複チェック
      const existing = await tx.dailyReport.findUnique({
        where: { userId_reportDate: { userId: currentUserId, reportDate } },
        select: { reportId: true },
      });
      if (existing) throw new DuplicateReportError();

      // 日報を作成
      const report = await tx.dailyReport.create({
        data: { userId: currentUserId, reportDate, status },
      });

      // 訪問記録・同行者を作成
      for (const vr of visit_records) {
        const visitedAt = new Date(`${report_date}T${vr.visited_at}:00.000Z`);
        const visitRecord = await tx.visitRecord.create({
          data: {
            reportId: report.reportId,
            customerId: vr.customer_id,
            visitedAt,
            visitContent: vr.visit_content,
          },
        });

        // [要修正-4] 重複IDを除去して @@unique([visitId, userId]) 違反を防ぐ
        const uniqueAttendeeIds = [...new Set(vr.attendee_user_ids)];
        if (uniqueAttendeeIds.length > 0) {
          await tx.visitAttendee.createMany({
            data: uniqueAttendeeIds.map((uid) => ({
              visitId: visitRecord.visitId,
              userId: uid,
            })),
          });
        }
      }

      // 課題を作成
      if (problems.length > 0) {
        await tx.problem.createMany({
          data: problems.map((p) => ({
            reportId: report.reportId,
            content: p.content,
            sortOrder: p.sort_order,
          })),
        });
      }

      // 計画を作成
      if (plans.length > 0) {
        await tx.plan.createMany({
          data: plans.map((pl) => ({
            reportId: report.reportId,
            content: pl.content,
            sortOrder: pl.sort_order,
          })),
        });
      }

      return report;
    });

    return NextResponse.json(
      { data: { report_id: newReport.reportId } },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof DuplicateReportError) {
      return ApiError.duplicateReport();
    }
    // [要修正-3] 同時リクエスト時のユニーク制約違反（P2002）も DUPLICATE_REPORT に変換する
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return ApiError.duplicateReport();
    }
    return ApiError.internal();
  }
});
