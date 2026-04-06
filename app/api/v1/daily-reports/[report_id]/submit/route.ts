import { NextResponse } from "next/server";
import {
  withSalesRole,
  type AuthenticatedRequest,
  type RouteContext,
} from "@/lib/api-handler";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

/** 並行リクエストによる submitted 状態への変化を検知するセンチネルエラー */
class ReportAlreadySubmittedError extends Error {}

export const POST = withSalesRole(async (req: AuthenticatedRequest, ctx: RouteContext) => {
  const { report_id } = await ctx.params;

  const reportId = Number(report_id);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return ApiError.validationError([
      { field: "report_id", message: "report_id は正の整数で指定してください。" },
    ]);
  }

  const { user_id: currentUserId } = req.user;

  try {
    // 早期チェック: 存在・所有者・ステータス・訪問記録件数
    const report = await prisma.dailyReport.findUnique({
      where: { reportId },
      select: {
        userId: true,
        status: true,
        _count: { select: { visitRecords: true } },
      },
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

    if (report._count.visitRecords === 0) {
      return ApiError.validationError([
        { field: "visit_records", message: "訪問記録が1件以上必要です。" },
      ]);
    }

    // TOCTOU 対策: status: "draft" を条件に updateMany で原子的に更新
    const submittedAt = new Date();
    const result = await prisma.dailyReport.updateMany({
      where: { reportId, status: "draft" },
      data: { status: "submitted", submittedAt },
    });

    // 並行して別リクエストが先に submit した場合
    if (result.count === 0) throw new ReportAlreadySubmittedError();

    return NextResponse.json({
      data: {
        report_id: reportId,
        status: "submitted",
        submitted_at: submittedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof ReportAlreadySubmittedError) {
      return ApiError.reportAlreadySubmitted();
    }
    return ApiError.internal();
  }
});
