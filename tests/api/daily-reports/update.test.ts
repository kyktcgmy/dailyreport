import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";
import { Prisma } from "@prisma/client";

// Prisma をモック
vi.mock("@/lib/prisma", () => ({
  prisma: {
    dailyReport: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// token-blacklist をモック
vi.mock("@/lib/token-blacklist", () => ({
  isBlacklisted: vi.fn().mockReturnValue(false),
}));

// モック後にインポートする
import { PUT } from "@/app/api/v1/daily-reports/[report_id]/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";

const mockFindUnique = vi.mocked(prisma.dailyReport.findUnique);
const mockIsBlacklisted = vi.mocked(isBlacklisted);

const SALES_USER_ID = 1;
const OTHER_SALES_USER_ID = 99;

/** トランザクション内で使う tx のモックオブジェクト */
const mockTx = {
  visitRecord: {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  visitAttendee: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  problem: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  plan: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  dailyReport: {
    update: vi.fn(),
  },
};

function makeRequest(reportId: number | string, token: string, body: object): NextRequest {
  return new NextRequest(`http://localhost/api/v1/daily-reports/${reportId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(reportId: number | string) {
  return { params: Promise.resolve({ report_id: String(reportId) }) };
}

const validBody = {
  report_date: "2026-03-10",
  status: "draft",
  visit_records: [
    {
      customer_id: 10,
      visited_at: "10:00",
      visit_content: "更新内容",
      attendee_user_ids: [],
    },
  ],
  problems: [{ content: "更新課題", sort_order: 1 }],
  plans: [{ content: "更新計画", sort_order: 1 }],
};

let salesToken: string;
let managerToken: string;

beforeEach(async () => {
  vi.clearAllMocks();
  mockIsBlacklisted.mockReturnValue(false);

  salesToken = await signJwt({
    user_id: SALES_USER_ID,
    email: "sales@example.com",
    role: "sales",
  });
  managerToken = await signJwt({
    user_id: 5,
    email: "manager@example.com",
    role: "manager",
  });

  // デフォルト: 存在する draft 日報、所有者は SALES_USER_ID
  mockFindUnique.mockResolvedValue({
    reportId: 42,
    userId: SALES_USER_ID,
    status: "draft",
  });

  // デフォルトトランザクション: 既存訪問なし
  mockTx.visitRecord.findMany.mockResolvedValue([]);
  mockTx.visitRecord.create.mockResolvedValue({ visitId: 101 });
  mockTx.visitAttendee.createMany.mockResolvedValue({ count: 0 });
  mockTx.problem.createMany.mockResolvedValue({ count: 0 });
  mockTx.plan.createMany.mockResolvedValue({ count: 0 });
  mockTx.visitRecord.deleteMany.mockResolvedValue({ count: 0 });
  mockTx.visitAttendee.deleteMany.mockResolvedValue({ count: 0 });
  mockTx.problem.deleteMany.mockResolvedValue({ count: 0 });
  mockTx.plan.deleteMany.mockResolvedValue({ count: 0 });
  mockTx.dailyReport.update.mockResolvedValue({ reportId: 42 });

  vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(mockTx as never));
});

describe("PUT /api/v1/daily-reports/:report_id", () => {
  // DR-301: 正常系 - draft日報を正常更新できる
  it("DR-301: draft日報を正常更新すると200とreport_idを返す", async () => {
    const req = makeRequest(42, salesToken, validBody);
    const ctx = makeParams(42);

    const res = await PUT(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.report_id).toBe(42);

    // 旧データの削除が行われること
    expect(mockTx.visitRecord.deleteMany).toHaveBeenCalledWith({ where: { reportId: 42 } });
    expect(mockTx.problem.deleteMany).toHaveBeenCalledWith({ where: { reportId: 42 } });
    expect(mockTx.plan.deleteMany).toHaveBeenCalledWith({ where: { reportId: 42 } });

    // 日報本体が更新されること
    expect(mockTx.dailyReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reportId: 42 },
        data: expect.objectContaining({
          reportDate: new Date("2026-03-10T00:00:00.000Z"),
          status: "draft",
        }),
      })
    );
  });

  // DR-302: submitted日報を更新しようとすると403 REPORT_ALREADY_SUBMITTED
  it("DR-302: submitted日報を更新しようとすると403 REPORT_ALREADY_SUBMITTEDを返す", async () => {
    mockFindUnique.mockResolvedValue({
      reportId: 42,
      userId: SALES_USER_ID,
      status: "submitted",
    });

    const req = makeRequest(42, salesToken, validBody);
    const ctx = makeParams(42);

    const res = await PUT(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("REPORT_ALREADY_SUBMITTED");
    // トランザクションは呼ばれないこと
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // DR-303: 他ユーザーの日報を更新しようとすると403 FORBIDDEN
  it("DR-303: 他ユーザーの日報を更新しようとすると403 FORBIDDENを返す", async () => {
    mockFindUnique.mockResolvedValue({
      reportId: 42,
      userId: OTHER_SALES_USER_ID,
      status: "draft",
    });

    const req = makeRequest(42, salesToken, validBody);
    const ctx = makeParams(42);

    const res = await PUT(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    // トランザクションは呼ばれないこと
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // DR-304: managerが日報を更新しようとすると403 FORBIDDEN
  it("DR-304: managerロールでリクエストすると403 FORBIDDENを返す（withSalesRoleでブロック）", async () => {
    const req = makeRequest(42, managerToken, validBody);
    const ctx = makeParams(42);

    const res = await PUT(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    // withSalesRoleでブロックされるためfindUniqueは呼ばれないこと
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  // 存在しない日報IDは404 NOT_FOUND
  it("存在しない日報IDを指定すると404 NOT_FOUNDを返す", async () => {
    mockFindUnique.mockResolvedValue(null);

    const req = makeRequest(9999, salesToken, validBody);
    const ctx = makeParams(9999);

    const res = await PUT(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // 無効なreport_id ("abc") は400 VALIDATION_ERROR
  it("無効なreport_id（abc）を指定すると400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest("abc", salesToken, validBody);
    const ctx = makeParams("abc");

    const res = await PUT(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // 既存訪問記録がある場合、visitAttendeeが先に削除される
  it("既存の訪問記録がある場合、visitAttendeeを先に削除してからvisitRecordを削除する", async () => {
    mockTx.visitRecord.findMany.mockResolvedValue([{ visitId: 201 }, { visitId: 202 }]);

    const req = makeRequest(42, salesToken, validBody);
    const ctx = makeParams(42);

    const res = await PUT(req, ctx);

    expect(res.status).toBe(200);
    // visitAttendee.deleteMany が visitRecord削除より先に呼ばれること
    expect(mockTx.visitAttendee.deleteMany).toHaveBeenCalledWith({
      where: { visitId: { in: [201, 202] } },
    });
    expect(mockTx.visitRecord.deleteMany).toHaveBeenCalledWith({ where: { reportId: 42 } });

    // 呼び出し順を検証（attendee削除 → visitRecord削除）
    const attendeeDeleteOrder = mockTx.visitAttendee.deleteMany.mock.invocationCallOrder[0];
    const visitRecordDeleteOrder = mockTx.visitRecord.deleteMany.mock.invocationCallOrder[0];
    expect(attendeeDeleteOrder).toBeLessThan(visitRecordDeleteOrder);
  });

  // P2002エラーはDUPLICATE_REPORTに変換される
  it("トランザクション内でP2002が発生した場合は400 DUPLICATE_REPORTを返す", async () => {
    const p2002Error = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "5.0.0" }
    );
    vi.mocked(prisma.$transaction).mockRejectedValue(p2002Error);

    const req = makeRequest(42, salesToken, validBody);
    const ctx = makeParams(42);

    const res = await PUT(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("DUPLICATE_REPORT");
  });

  // visit_recordsの重複attendee_user_idsが除去される
  it("attendee_user_idsに重複したIDを指定しても201を返し重複なしで作成される", async () => {
    const bodyWithDuplicateAttendees = {
      ...validBody,
      visit_records: [
        {
          customer_id: 10,
          visited_at: "10:00",
          visit_content: "更新内容",
          attendee_user_ids: [2, 3, 2], // userId=2 が重複
        },
      ],
    };

    const req = makeRequest(42, salesToken, bodyWithDuplicateAttendees);
    const ctx = makeParams(42);

    const res = await PUT(req, ctx);

    expect(res.status).toBe(200);
    // 重複を除いた [2, 3] で createMany が呼ばれること
    expect(mockTx.visitAttendee.createMany).toHaveBeenCalledWith({
      data: [
        { visitId: 101, userId: 2 },
        { visitId: 101, userId: 3 },
      ],
    });
  });

  // 未認証は401
  it("Authorizationヘッダーなしでリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = new NextRequest("http://localhost/api/v1/daily-reports/42", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    const ctx = makeParams(42);

    const res = await PUT(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  // DB error (findUnique throws) は500
  it("findUnique でDBエラーが発生した場合は500 INTERNAL_SERVER_ERRORを返す", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB connection error"));

    const req = makeRequest(42, salesToken, validBody);
    const ctx = makeParams(42);

    const res = await PUT(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  // バリデーション: report_date 未入力
  it("report_dateが未入力の場合は400 VALIDATION_ERRORを返す", async () => {
    const { report_date: _omitted, ...bodyWithoutDate } = validBody;
    const req = makeRequest(42, salesToken, bodyWithoutDate);
    const ctx = makeParams(42);

    const res = await PUT(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const detail = body.error.details?.find((d: { field: string }) => d.field === "report_date");
    expect(detail).toBeDefined();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // バリデーション: report_date が存在しない日付
  it("report_dateに存在しない日付（2026-13-01）を指定すると400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest(42, salesToken, { ...validBody, report_date: "2026-13-01" });
    const ctx = makeParams(42);

    const res = await PUT(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // バリデーション: visited_at に無効な時刻
  it("visited_atに無効な時刻（25:00）を指定すると400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest(42, salesToken, {
      ...validBody,
      visit_records: [{ customer_id: 10, visited_at: "25:00", visit_content: "内容", attendee_user_ids: [] }],
    });
    const ctx = makeParams(42);

    const res = await PUT(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
