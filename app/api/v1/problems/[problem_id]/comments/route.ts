export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  withManagerRole,
  validateRequestBody,
  type AuthenticatedRequest,
  type RouteContext,
} from "@/lib/api-handler";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

const CommentBodySchema = z.object({
  content: z.string().min(1, "content は必須です。"),
});

export const POST = withManagerRole(async (req: AuthenticatedRequest, ctx: RouteContext) => {
  const { problem_id } = await ctx.params;

  const problemId = Number(problem_id);
  if (!Number.isInteger(problemId) || problemId <= 0) {
    return ApiError.validationError([
      { field: "problem_id", message: "problem_id は正の整数で指定してください。" },
    ]);
  }

  const { user_id: currentUserId } = req.user;

  try {
    const validated = await validateRequestBody(req, CommentBodySchema);
    if (validated.error) return validated.error;

    const { content } = validated.data;

    // problem の存在確認
    const problem = await prisma.problem.findUnique({
      where: { problemId },
      select: { problemId: true },
    });

    if (!problem) {
      return ApiError.notFound("指定された Problem が存在しません。");
    }

    // コメントを作成
    const comment = await prisma.comment.create({
      data: {
        targetType: "problem",
        targetId: problemId,
        userId: currentUserId,
        content,
      },
      include: {
        user: { select: { userId: true, name: true } },
      },
    });

    return NextResponse.json(
      {
        data: {
          comment_id: comment.commentId,
          commenter: { user_id: comment.user.userId, name: comment.user.name },
          content: comment.content,
          created_at: comment.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch {
    return ApiError.internal();
  }
});
