import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Prisma をモック
vi.mock("@/lib/prisma", () => ({
  prisma: {
    dailyReport: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

// token-blacklist をモック
vi.mock("@/lib/token-blacklist", () => ({
  isBlacklisted: vi.fn().mockReturnValue(false),
}));

// モック後にインポートする
import { POST } from "@/app/api/v1/daily-reports/[report_id]/submit/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";
import { signJwt } from "@/lib/auth";

const SALES_USER_ID = 1;
const OTHER_SALES_USER_ID = 99;

function makeRequest(reportId: number | string, token: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/daily-reports/${reportId}/submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

function makeParams(reportId: number | string) {
  return { params: Promise.resolve({ report_id: String(reportId) }) };
}

let salesToken: string;
let managerToken: string;

beforeAll(async () => {
  salesToken = await signJwt({ user_id: SALES_USER_ID, email: "sales@example.com", role: "sales" });
  managerToken = await signJwt({ user_id: 5, email: "manager@example.com", role: "manager" });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isBlacklisted).mockReturnValue(false);

  // デフォルト: draft 日報・訪問記録1件・所有者は SALES_USER_ID
  vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue({
    userId: SALES_USER_ID,
    status: "draft",
    _count: { visitRecords: 1 },
  } as never);

  vi.mocked(prisma.dailyReport.updateMany).mockResolvedValue({ count: 1 });
});

describe("POST /api/v1/daily-reports/:report_id/submit", () => {
  // DR-401: 正常系 - draft日報を正常提出できる
  it("DR-401: draft日報を正常提出すると200とreport_id・status・submitted_atを返す", async () => {
    const req = makeRequest(42, salesToken);
    const ctx = makeParams(42);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.report_id).toBe(42);
    expect(body.data.status).toBe("submitted");
    // submitted_at は ISO 8601 形式の文字列
    expect(body.data.submitted_at).toBeTruthy();
    expect(body.data.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // updateMany が status: "draft" 条件付き・submitted データで呼ばれること（TOCTOU 対策）
    expect(vi.mocked(prisma.dailyReport.updateMany)).toHaveBeenCalledWith({
      where: { reportId: 42, status: "draft" },
      data: { status: "submitted", submittedAt: expect.any(Date) },
    });
  });

  // DR-402: 訪問記録が0件の場合は400 VALIDATION_ERROR
  it("DR-402: 訪問記録が0件の日報を提出しようとすると400 VALIDATION_ERRORを返す", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue({
      userId: SALES_USER_ID,
      status: "draft",
      _count: { visitRecords: 0 },
    } as never);

    const req = makeRequest(42, salesToken);
    const ctx = makeParams(42);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const detail = body.error.details?.find((d: { field: string }) => d.field === "visit_records");
    expect(detail).toBeDefined();
    // updateMany は呼ばれないこと
    expect(vi.mocked(prisma.dailyReport.updateMany)).not.toHaveBeenCalled();
  });

  // DR-403: 既に提出済みの日報は403 REPORT_ALREADY_SUBMITTED
  it("DR-403: 既に提出済みの日報を提出しようとすると403 REPORT_ALREADY_SUBMITTEDを返す", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue({
      userId: SALES_USER_ID,
      status: "submitted",
      _count: { visitRecords: 1 },
    } as never);

    const req = makeRequest(42, salesToken);
    const ctx = makeParams(42);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("REPORT_ALREADY_SUBMITTED");
    // updateMany は呼ばれないこと
    expect(vi.mocked(prisma.dailyReport.updateMany)).not.toHaveBeenCalled();
  });

  // DR-404: 他ユーザーの日報は403 FORBIDDEN
  it("DR-404: 他ユーザーの日報を提出しようとすると403 FORBIDDENを返す", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue({
      userId: OTHER_SALES_USER_ID,
      status: "draft",
      _count: { visitRecords: 1 },
    } as never);

    const req = makeRequest(42, salesToken);
    const ctx = makeParams(42);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    // updateMany は呼ばれないこと
    expect(vi.mocked(prisma.dailyReport.updateMany)).not.toHaveBeenCalled();
  });

  // 存在しない日報IDは404 NOT_FOUND
  it("存在しない日報IDを指定すると404 NOT_FOUNDを返す", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(null);

    const req = makeRequest(9999, salesToken);
    const ctx = makeParams(9999);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(vi.mocked(prisma.dailyReport.updateMany)).not.toHaveBeenCalled();
  });

  // 無効なreport_id ("abc") は400 VALIDATION_ERROR
  it("無効なreport_id（abc）を指定すると400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest("abc", salesToken);
    const ctx = makeParams("abc");

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    // findUnique は呼ばれないこと
    expect(vi.mocked(prisma.dailyReport.findUnique)).not.toHaveBeenCalled();
  });

  // managerロールは403 FORBIDDEN（withSalesRoleでブロック）
  it("managerロールでリクエストすると403 FORBIDDENを返す（withSalesRoleでブロック）", async () => {
    const req = makeRequest(42, managerToken);
    const ctx = makeParams(42);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    // withSalesRoleでブロックされるためfindUniqueは呼ばれないこと
    expect(vi.mocked(prisma.dailyReport.findUnique)).not.toHaveBeenCalled();
  });

  // 未認証は401 UNAUTHORIZED
  it("Authorizationヘッダーなしでリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = new NextRequest("http://localhost/api/v1/daily-reports/42/submit", {
      method: "POST",
    });
    const ctx = makeParams(42);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(vi.mocked(prisma.dailyReport.findUnique)).not.toHaveBeenCalled();
  });

  // TOCTOU競合: updateMany returns { count: 0 } → 403 REPORT_ALREADY_SUBMITTED
  it("TOCTOU競合: updateManyのcountが0の場合（並行submit競合）は403 REPORT_ALREADY_SUBMITTEDを返す", async () => {
    vi.mocked(prisma.dailyReport.updateMany).mockResolvedValue({ count: 0 });

    const req = makeRequest(42, salesToken);
    const ctx = makeParams(42);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("REPORT_ALREADY_SUBMITTED");
  });

  // DBエラー (findUnique throws) → 500 INTERNAL_SERVER_ERROR
  it("findUniqueでDBエラーが発生した場合は500 INTERNAL_SERVER_ERRORを返す", async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockRejectedValue(new Error("DB connection error"));

    const req = makeRequest(42, salesToken);
    const ctx = makeParams(42);

    const res = await POST(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
