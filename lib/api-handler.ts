import { NextRequest, NextResponse } from "next/server";
import { ZodSchema, ZodError } from "zod";
import { extractBearerToken, verifyJwt, type JwtPayload, type UserRole } from "./auth";
import { ApiError } from "./errors";
import { isBlacklisted } from "./token-blacklist";

export type AuthenticatedRequest = NextRequest & {
  user: JwtPayload;
};

export type RouteContext = { params: Promise<Record<string, string>> };

type AuthenticatedHandler = (
  req: AuthenticatedRequest,
  ctx: RouteContext
) => Promise<NextResponse>;

type PlainHandler = (
  req: NextRequest,
  ctx: RouteContext
) => Promise<NextResponse>;

/**
 * 認証ミドルウェア HOF
 * Authorization: Bearer <token> を検証し、有効なユーザー情報を req.user にセットする
 */
export function withAuth(handler: AuthenticatedHandler): PlainHandler {
  return async (req: NextRequest, ctx: RouteContext): Promise<NextResponse> => {
    const token = extractBearerToken(req.headers.get("Authorization"));
    if (!token) {
      return ApiError.unauthorized();
    }

    if (isBlacklisted(token)) {
      return ApiError.unauthorized("トークンは無効化されています。");
    }

    let user: JwtPayload;
    try {
      user = await verifyJwt(token);
    } catch {
      return ApiError.unauthorized("トークンが無効または期限切れです。");
    }

    const authedReq = Object.assign(req, { user }) as AuthenticatedRequest;
    return handler(authedReq, ctx);
  };
}

/**
 * ロールベースアクセス制御ミドルウェア HOF
 * 指定ロールのユーザーのみアクセスを許可する
 */
export function withRole(
  roles: UserRole[],
  handler: AuthenticatedHandler
): PlainHandler {
  return withAuth(async (req: AuthenticatedRequest, ctx: RouteContext) => {
    if (!roles.includes(req.user.role)) {
      return ApiError.forbidden();
    }
    return handler(req, ctx);
  });
}

/**
 * salesロール専用ミドルウェア HOF
 */
export function withSalesRole(handler: AuthenticatedHandler): PlainHandler {
  return withRole(["sales"], handler);
}

/**
 * managerロール専用ミドルウェア HOF
 */
export function withManagerRole(handler: AuthenticatedHandler): PlainHandler {
  return withRole(["manager"], handler);
}

/**
 * Zodによるリクエストボディバリデーション
 * バリデーション失敗時は 400 VALIDATION_ERROR を返す
 */
export async function validateRequestBody<T>(
  req: NextRequest,
  schema: ZodSchema<T>
): Promise<{ data: T; error: null } | { data: null; error: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      data: null,
      error: ApiError.validationError([
        { field: "body", message: "リクエストボディのJSONが不正です。" },
      ]),
    };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const details = formatZodError(result.error);
    return { data: null, error: ApiError.validationError(details) };
  }

  return { data: result.data, error: null };
}

/**
 * Zodによるクエリパラメータバリデーション
 */
export function validateQueryParams<T>(
  req: NextRequest,
  schema: ZodSchema<T>
): { data: T; error: null } | { data: null; error: NextResponse } {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) {
    const details = formatZodError(result.error);
    return { data: null, error: ApiError.validationError(details) };
  }
  return { data: result.data, error: null };
}

function formatZodError(
  error: ZodError
): Array<{ field: string; message: string }> {
  return error.issues.map((e) => ({
    field: e.path.join("."),
    message: e.message,
  }));
}
