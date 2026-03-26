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
  // trim() でホワイトスペースのみの入力を弾く
  content: z.string().trim().min(1, "content は必須です。"),
});

export const POST = withManagerRole(async (req: AuthenticatedRequest, ctx: RouteContext) => {
  const { plan_id } = await ctx.params;

  const planId = Number(plan_id);
  if (!Number.isInteger(planId) || planId <= 0) {
    return ApiError.validationError([
      { field: "plan_id", message: "plan_id は正の整数で指定してください。" },
    ]);
  }

  const { user_id: currentUserId } = req.user;

  try {
    const validated = await validateRequestBody(req, CommentBodySchema);
    if (validated.error) return validated.error;

    const { content } = validated.data;

    // plan の存在確認
    const plan = await prisma.plan.findUnique({
      where: { planId },
      select: { planId: true },
    });

    if (!plan) {
      return ApiError.notFound("指定された Plan が存在しません。");
    }

    // コメントを作成
    const comment = await prisma.comment.create({
      data: {
        targetType: "plan",
        targetId: planId,
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
