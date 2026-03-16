import { NextResponse } from "next/server";
import {
  withAuth,
  type AuthenticatedRequest,
  type RouteContext,
} from "@/lib/api-handler";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

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
