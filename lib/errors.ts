import { NextResponse } from "next/server";

export type ErrorCode =
  | "INVALID_CREDENTIALS"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "DUPLICATE_REPORT"
  | "REPORT_ALREADY_SUBMITTED"
  | "CANNOT_DELETE_SELF"
  | "INTERNAL_SERVER_ERROR";

interface ErrorDetail {
  field: string;
  message: string;
}

interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
}

function errorResponse(
  status: number,
  body: ErrorBody
): NextResponse {
  return NextResponse.json({ error: body }, { status });
}

export const ApiError = {
  unauthorized(message = "認証が必要です。"): NextResponse {
    return errorResponse(401, { code: "UNAUTHORIZED", message });
  },

  invalidCredentials(): NextResponse {
    return errorResponse(401, {
      code: "INVALID_CREDENTIALS",
      message: "メールアドレスまたはパスワードが正しくありません。",
    });
  },

  forbidden(message = "この操作を行う権限がありません。"): NextResponse {
    return errorResponse(403, { code: "FORBIDDEN", message });
  },

  notFound(message = "リソースが存在しません。"): NextResponse {
    return errorResponse(404, { code: "NOT_FOUND", message });
  },

  validationError(details?: ErrorDetail[]): NextResponse {
    return errorResponse(400, {
      code: "VALIDATION_ERROR",
      message: "入力内容に誤りがあります。",
      details,
    });
  },

  duplicateReport(): NextResponse {
    return errorResponse(400, {
      code: "DUPLICATE_REPORT",
      message: "同一日付の日報が既に存在します。",
    });
  },

  reportAlreadySubmitted(): NextResponse {
    return errorResponse(403, {
      code: "REPORT_ALREADY_SUBMITTED",
      message: "提出済みの日報は編集できません。",
    });
  },

  cannotDeleteSelf(): NextResponse {
    return errorResponse(403, {
      code: "CANNOT_DELETE_SELF",
      message: "自分自身を削除することはできません。",
    });
  },

  internal(message = "サーバー内部エラーが発生しました。"): NextResponse {
    return errorResponse(500, {
      code: "INTERNAL_SERVER_ERROR",
      message,
    });
  },
};
