import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Prisma をモック
vi.mock("@/lib/prisma", () => ({
  prisma: {
    problem: { findUnique: vi.fn() },
    comment: { create: vi.fn() },
  },
}));

// token-blacklist をモック
vi.mock("@/lib/token-blacklist", () => ({
  isBlacklisted: vi.fn().mockReturnValue(false),
}));

// モック後にインポートする
import { POST } from "@/app/api/v1/problems/[problem_id]/comments/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";
import { signJwt } from "@/lib/auth";

const MANAGER_USER_ID = 5;
const SALES_USER_ID = 1;

function makeRequest(problemId: number | string, token: string, body: object): NextRequest {
  return new NextRequest(`http://localhost/api/v1/problems/${problemId}/comments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(problemId: number | string) {
  return { params: Promise.resolve({ problem_id: String(problemId) }) };
}

let managerToken: string;
let salesToken: string;

beforeAll(async () => {
  managerToken = await signJwt({ user_id: MANAGER_USER_ID, email: "manager@example.com", role: "manager" });
  salesToken = await signJwt({ user_id: SALES_USER_ID, email: "sales@example.com", role: "sales" });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isBlacklisted).mockReturnValue(false);

  // デフォルト: problem は存在する
  vi.mocked(prisma.problem.findUnique).mockResolvedValue({ problemId: 201 } as never);

  // デフォルト: コメント作成成功
  vi.mocked(prisma.comment.create).mockResolvedValue({
    commentId: 301,
    targetType: "problem",
    targetId: 201,
    userId: MANAGER_USER_ID,
    content: "確認しました",
    createdAt: new Date("2026-03-10T19:30:00.000Z"),
    user: { userId: MANAGER_USER_ID, name: "上司A" },
  } as never);
});

describe("POST /api/v1/problems/:problem_id/comments", () => {
  // CMT-001: 上長が正常にコメントを追加できる
  it("CMT-001: 上長が正常にコメントを追加すると201とコメント情報を返す", async () => {
    const req = makeRequest(201, managerToken, { content: "確認しました" });
    const ctx = makeParams(201);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.comment_id).toBe(301);
    expect(body.data.commenter).toEqual({ user_id: MANAGER_USER_ID, name: "上司A" });
    expect(body.data.content).toBe("確認しました");
    expect(body.data.created_at).toBe("2026-03-10T19:30:00.000Z");

    // comment.create が正しい引数で呼ばれること
    expect(vi.mocked(prisma.comment.create)).toHaveBeenCalledWith({
      data: {
        targetType: "problem",
        targetId: 201,
        userId: MANAGER_USER_ID,
        content: "確認しました",
      },
      include: {
        user: { select: { userId: true, name: true } },
      },
    });
  });

  // CMT-002: 営業がコメントを追加しようとすると403 FORBIDDEN
  it("CMT-002: 営業ロールでコメントを追加しようとすると403 FORBIDDENを返す", async () => {
    const req = makeRequest(201, salesToken, { content: "確認しました" });
    const ctx = makeParams(201);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    // withManagerRole でブロックされるため DB は呼ばれないこと
    expect(vi.mocked(prisma.problem.findUnique)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.comment.create)).not.toHaveBeenCalled();
  });

  // CMT-003: content が空の場合は400 VALIDATION_ERROR
  it("CMT-003: content が空文字の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest(201, managerToken, { content: "" });
    const ctx = makeParams(201);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const detail = body.error.details?.find((d: { field: string }) => d.field === "content");
    expect(detail).toBeDefined();
    // コメント作成は呼ばれないこと
    expect(vi.mocked(prisma.comment.create)).not.toHaveBeenCalled();
  });

  // CMT-004: 存在しない problem_id は404 NOT_FOUND
  it("CMT-004: 存在しない problem_id を指定すると404 NOT_FOUNDを返す", async () => {
    vi.mocked(prisma.problem.findUnique).mockResolvedValue(null);

    const req = makeRequest(9999, managerToken, { content: "確認しました" });
    const ctx = makeParams(9999);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    // コメント作成は呼ばれないこと
    expect(vi.mocked(prisma.comment.create)).not.toHaveBeenCalled();
  });

  // CMT-005: 未認証は401 UNAUTHORIZED
  it("CMT-005: Authorizationヘッダーなしでリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = new NextRequest("http://localhost/api/v1/problems/201/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "確認しました" }),
    });
    const ctx = makeParams(201);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    // 認証チェックでブロックされるため DB は呼ばれないこと
    expect(vi.mocked(prisma.problem.findUnique)).not.toHaveBeenCalled();
  });

  // 無効な problem_id ("abc") は400 VALIDATION_ERROR
  it("無効な problem_id（abc）を指定すると400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest("abc", managerToken, { content: "確認しました" });
    const ctx = makeParams("abc");

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const detail = body.error.details?.find((d: { field: string }) => d.field === "problem_id");
    expect(detail).toBeDefined();
    // DB は呼ばれないこと
    expect(vi.mocked(prisma.problem.findUnique)).not.toHaveBeenCalled();
  });

  // DBエラー (comment.create throws) → 500 INTERNAL_SERVER_ERROR
  it("comment.create でDBエラーが発生した場合は500 INTERNAL_SERVER_ERRORを返す", async () => {
    vi.mocked(prisma.comment.create).mockRejectedValue(new Error("DB connection error"));

    const req = makeRequest(201, managerToken, { content: "確認しました" });
    const ctx = makeParams(201);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
