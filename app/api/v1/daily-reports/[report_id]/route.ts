export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  withAuth,
  withSalesRole,
  validateRequestBody,
  type AuthenticatedRequest,
  type RouteContext,
} from "@/lib/api-handler";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

// ============================================================
// PUT /daily-reports/:report_id
// ============================================================

const VisitRecordInputSchema = z.object({
  customer_id: z.number({ error: "customer_id は必須です。" }).int().positive(),
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

const UpdateDailyReportSchema = z.object({
  report_date: z
    .string({ error: "report_date は必須です。" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "report_date は YYYY-MM-DD 形式で入力してください。")
    .refine(
      (val) => !isNaN(new Date(`${val}T00:00:00.000Z`).getTime()),
      "report_date に存在しない日付が指定されています。"
    ),
  // [要修正-2] PUT は下書き更新専用エンドポイント。submitted への遷移は POST /submit で行う
  status: z.literal("draft").default("draft"),
  visit_records: z.array(VisitRecordInputSchema).default([]),
  problems: z.array(ProblemInputSchema).default([]),
  plans: z.array(PlanInputSchema).default([]),
});

/** 並行リクエストによる submitted 状態への変化を検知するセンチネルエラー */
class ReportAlreadySubmittedError extends Error {}

export const PUT = withSalesRole(async (req: AuthenticatedRequest, ctx: RouteContext) => {
  const { report_id } = await ctx.params;

  const reportId = Number(report_id);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return ApiError.validationError([
      { field: "report_id", message: "report_id は正の整数で指定してください。" },
    ]);
  }

  const { user_id: currentUserId } = req.user;

  try {
    // トランザクション外で早期チェック
    const report = await prisma.dailyReport.findUnique({
      where: { reportId },
      select: { reportId: true, userId: true, status: true },
    });

    if (!report) {
      return ApiError.notFound("指定された日報が存在しません。");
    }

    if (report.userId !== currentUserId) {
      return ApiError.forbidden();
    }

    if (report.status === "submitted") {
      return ApiError.reportAlreadySubmitted();
    }

    const validated = await validateRequestBody(req, UpdateDailyReportSchema);
    if (validated.error) return validated.error;

    const { report_date, status, visit_records, problems, plans } = validated.data;

    await prisma.$transaction(async (tx) => {
      // 既存訪問記録IDを取得（attendees削除に必要）
      const existingVisits = await tx.visitRecord.findMany({
        where: { reportId },
        select: { visitId: true },
      });
      const visitIds = existingVisits.map((v) => v.visitId);

      // 旧データを削除（外部キー制約の順序に従う）
      if (visitIds.length > 0) {
        await tx.visitAttendee.deleteMany({ where: { visitId: { in: visitIds } } });
      }
      await tx.visitRecord.deleteMany({ where: { reportId } });
      await tx.problem.deleteMany({ where: { reportId } });
      await tx.plan.deleteMany({ where: { reportId } });

      // [要修正-1] 日報本体を更新（status: "draft" を条件に加え TOCTOU 競合を防ぐ）
      const result = await tx.dailyReport.updateMany({
        where: { reportId, status: "draft" },
        data: { reportDate: new Date(`${report_date}T00:00:00.000Z`), status },
      });
      // 並行して POST /submit が実行され submitted になっていた場合
      if (result.count === 0) throw new ReportAlreadySubmittedError();

      // 訪問記録・同行者を再作成
      for (const vr of visit_records) {
        const visitedAt = new Date(`${report_date}T${vr.visited_at}:00.000Z`);
        const visitRecord = await tx.visitRecord.create({
          data: {
            reportId,
            customerId: vr.customer_id,
            visitedAt,
            visitContent: vr.visit_content,
          },
        });

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

      // 課題を再作成
      if (problems.length > 0) {
        await tx.problem.createMany({
          data: problems.map((p) => ({
            reportId,
            content: p.content,
            sortOrder: p.sort_order,
          })),
        });
      }

      // 計画を再作成
      if (plans.length > 0) {
        await tx.plan.createMany({
          data: plans.map((pl) => ({
            reportId,
            content: pl.content,
            sortOrder: pl.sort_order,
          })),
        });
      }
    });

    return NextResponse.json({ data: { report_id: reportId } });
  } catch (error) {
    if (error instanceof ReportAlreadySubmittedError) {
      return ApiError.reportAlreadySubmitted();
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return ApiError.duplicateReport();
    }
    return ApiError.internal();
  }
});

// ============================================================
// GET /daily-reports/:report_id
// ============================================================

export const GET = withAuth(async (req: AuthenticatedRequest, ctx: RouteContext) => {
  const { report_id } = await ctx.params;

  const reportId = Number(report_id);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return ApiError.validationError([
      { field: "report_id", message: "report_id は正の整数で指定してください。" },
    ]);
  }

  const { user_id: currentUserId, role } = req.user;

  try {
    const report = await prisma.dailyReport.findUnique({
      where: { reportId },
      include: {
        user: { select: { userId: true, name: true } },
        visitRecords: {
          include: {
            customer: { select: { customerId: true, name: true, companyName: true } },
            attendees: {
              include: { user: { select: { userId: true, name: true } } },
              orderBy: { userId: "asc" },
            },
          },
          orderBy: { visitedAt: "asc" },
        },
        problems: { orderBy: { sortOrder: "asc" } },
        plans: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!report) {
      return ApiError.notFound("指定された日報が存在しません。");
    }

    // 権限チェック
    if (role === "sales") {
      if (report.userId !== currentUserId) {
        return ApiError.forbidden();
      }
    } else {
      // manager: 自分自身または部下の日報のみ閲覧可能
      const subordinates = await prisma.user.findMany({
        where: { managerId: currentUserId, deletedAt: null },
        select: { userId: true },
      });
      const accessibleIds = [currentUserId, ...subordinates.map((u) => u.userId)];
      if (!accessibleIds.includes(report.userId)) {
        return ApiError.forbidden();
      }
    }

    // Problem・Plan に紐づくコメントを取得
    const problemIds = report.problems.map((p) => p.problemId);
    const planIds = report.plans.map((pl) => pl.planId);

    const conditions: Array<{ targetType: "problem" | "plan"; targetId: { in: number[] } }> = [];
    if (problemIds.length > 0) {
      conditions.push({ targetType: "problem" as const, targetId: { in: problemIds } });
    }
    if (planIds.length > 0) {
      conditions.push({ targetType: "plan" as const, targetId: { in: planIds } });
    }

    const comments =
      conditions.length > 0
        ? await prisma.comment.findMany({
            where: { OR: conditions },
            include: { user: { select: { userId: true, name: true } } },
            orderBy: { createdAt: "asc" },
          })
        : [];

    // コメントを target_type + target_id でグループ化
    const commentsByTarget = new Map<string, typeof comments>();
    for (const comment of comments) {
      const key = `${comment.targetType}:${comment.targetId}`;
      const group = commentsByTarget.get(key) ?? [];
      group.push(comment);
      commentsByTarget.set(key, group);
    }

    // レスポンスを構築
    const data = {
      report_id: report.reportId,
      report_date: report.reportDate.toISOString().split("T")[0],
      status: report.status,
      submitted_at: report.submittedAt?.toISOString() ?? null,
      user: { user_id: report.user.userId, name: report.user.name },
      visit_records: report.visitRecords.map((vr) => {
        const h = String(vr.visitedAt.getUTCHours()).padStart(2, "0");
        const m = String(vr.visitedAt.getUTCMinutes()).padStart(2, "0");
        return {
          visit_id: vr.visitId,
          customer: {
            customer_id: vr.customer.customerId,
            name: vr.customer.name,
            company_name: vr.customer.companyName,
          },
          visited_at: `${h}:${m}`,
          visit_content: vr.visitContent,
          attendees: vr.attendees.map((a) => ({
            user_id: a.user.userId,
            name: a.user.name,
          })),
        };
      }),
      problems: report.problems.map((p) => ({
        problem_id: p.problemId,
        content: p.content,
        sort_order: p.sortOrder,
        comments: (commentsByTarget.get(`problem:${p.problemId}`) ?? []).map((c) => ({
          comment_id: c.commentId,
          commenter: { user_id: c.user.userId, name: c.user.name },
          content: c.content,
          created_at: c.createdAt.toISOString(),
        })),
      })),
      plans: report.plans.map((pl) => ({
        plan_id: pl.planId,
        content: pl.content,
        sort_order: pl.sortOrder,
        comments: (commentsByTarget.get(`plan:${pl.planId}`) ?? []).map((c) => ({
          comment_id: c.commentId,
          commenter: { user_id: c.user.userId, name: c.user.name },
          content: c.content,
          created_at: c.createdAt.toISOString(),
        })),
      })),
    };

    return NextResponse.json({ data });
  } catch {
    return ApiError.internal();
  }
});
