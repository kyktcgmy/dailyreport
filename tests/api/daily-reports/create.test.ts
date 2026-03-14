import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { signJwt } from "@/lib/auth";

// Prisma をモック
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

// token-blacklist をモック
vi.mock("@/lib/token-blacklist", () => ({
  addToBlacklist: vi.fn(),
  isBlacklisted: vi.fn().mockReturnValue(false),
  clearBlacklist: vi.fn(),
}));

// モック後にインポートする
import { POST } from "@/app/api/v1/daily-reports/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";

const mockTransaction = vi.mocked(prisma.$transaction);
const mockIsBlacklisted = vi.mocked(isBlacklisted);

/** トランザクション内で使う tx のモックオブジェクト */
const mockTx = {
  dailyReport: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  visitRecord: {
    create: vi.fn(),
  },
  visitAttendee: {
    createMany: vi.fn(),
  },
  problem: {
    createMany: vi.fn(),
  },
  plan: {
    createMany: vi.fn(),
  },
};

function makePostRequest(body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/v1/daily-reports", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsBlacklisted.mockReturnValue(false);

  // デフォルト: 重複なし、作成成功
  mockTx.dailyReport.findUnique.mockResolvedValue(null);
  mockTx.dailyReport.create.mockResolvedValue({
    reportId: 42,
    userId: 1,
    reportDate: new Date("2026-03-10T00:00:00.000Z"),
    status: "draft",
    submittedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockTx.visitRecord.create.mockResolvedValue({
    visitId: 1,
    reportId: 42,
    customerId: 10,
    visitedAt: new Date("2026-03-10T10:00:00.000Z"),
    visitContent: "訪問内容",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockTx.visitAttendee.createMany.mockResolvedValue({ count: 0 });
  mockTx.problem.createMany.mockResolvedValue({ count: 0 });
  mockTx.plan.createMany.mockResolvedValue({ count: 0 });

  // トランザクションコールバックを実行するモック
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockTransaction.mockImplementation(async (fn: any) => fn(mockTx));
});

describe("POST /api/v1/daily-reports", () => {
  // DR-101: 正常作成（下書き）
  it("DR-101: 訪問記録1件で正常作成するとreport_idを含む201を返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        status: "draft",
        visit_records: [
          {
            customer_id: 10,
            visited_at: "10:00",
            visit_content: "新製品のデモを実施。好感触。",
            attendee_user_ids: [],
          },
        ],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.report_id).toBe(42);

    // 日報が正しいデータで作成されること
    expect(mockTx.dailyReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 1,
          status: "draft",
        }),
      })
    );
    // 訪問記録が正しいデータで作成されること（visitedAt の DateTime 変換も検証）
    expect(mockTx.visitRecord.create).toHaveBeenCalledTimes(1);
    expect(mockTx.visitRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 10,
          visitContent: "新製品のデモを実施。好感触。",
          visitedAt: new Date("2026-03-10T10:00:00.000Z"),
        }),
      })
    );
  });

  // DR-102: 正常作成（訪問記録複数件）
  it("DR-102: 訪問記録3件で正常作成すると201を返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    // 各訪問記録に異なる visitId を返す
    mockTx.visitRecord.create
      .mockResolvedValueOnce({ visitId: 1, reportId: 42, customerId: 10, visitedAt: new Date(), visitContent: "", createdAt: new Date(), updatedAt: new Date() })
      .mockResolvedValueOnce({ visitId: 2, reportId: 42, customerId: 11, visitedAt: new Date(), visitContent: "", createdAt: new Date(), updatedAt: new Date() })
      .mockResolvedValueOnce({ visitId: 3, reportId: 42, customerId: 12, visitedAt: new Date(), visitContent: "", createdAt: new Date(), updatedAt: new Date() });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        status: "draft",
        visit_records: [
          { customer_id: 10, visited_at: "09:00", visit_content: "A社訪問", attendee_user_ids: [] },
          { customer_id: 11, visited_at: "13:00", visit_content: "B社訪問", attendee_user_ids: [] },
          { customer_id: 12, visited_at: "16:00", visit_content: "C社訪問", attendee_user_ids: [] },
        ],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.report_id).toBe(42);
    // 訪問記録が3件分作成されること
    expect(mockTx.visitRecord.create).toHaveBeenCalledTimes(3);
  });

  // DR-103: 正常作成（同行者あり）
  it("DR-103: 同行者を指定すると visitAttendee が作成されて201を返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        status: "draft",
        visit_records: [
          {
            customer_id: 10,
            visited_at: "10:00",
            visit_content: "訪問内容",
            attendee_user_ids: [2, 3],
          },
        ],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.report_id).toBe(42);

    // visitAttendee が正しいデータで作成されること（visitId=1 は beforeEach のデフォルト）
    expect(mockTx.visitAttendee.createMany).toHaveBeenCalledWith({
      data: [
        { visitId: 1, userId: 2 },
        { visitId: 1, userId: 3 },
      ],
    });
  });

  // DR-104: 正常作成（Problem・Plan含む）
  it("DR-104: problems と plans を指定すると各テーブルに作成されて201を返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        status: "draft",
        visit_records: [
          { customer_id: 10, visited_at: "10:00", visit_content: "訪問内容" },
        ],
        problems: [
          { content: "価格について...", sort_order: 1 },
          { content: "競合について...", sort_order: 2 },
        ],
        plans: [
          { content: "見積書を作成...", sort_order: 1 },
        ],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.report_id).toBe(42);

    // problems が作成されること
    expect(mockTx.problem.createMany).toHaveBeenCalledWith({
      data: [
        { reportId: 42, content: "価格について...", sortOrder: 1 },
        { reportId: 42, content: "競合について...", sortOrder: 2 },
      ],
    });
    // plans が作成されること
    expect(mockTx.plan.createMany).toHaveBeenCalledWith({
      data: [
        { reportId: 42, content: "見積書を作成...", sortOrder: 1 },
      ],
    });
  });

  // DR-105: 同一日付の日報を重複作成
  it("DR-105: 同一ユーザー・同一日付の日報が既に存在する場合は400 DUPLICATE_REPORTを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    // 既存日報が存在する状態をモック
    mockTx.dailyReport.findUnique.mockResolvedValue({ reportId: 1 });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        status: "draft",
        visit_records: [
          { customer_id: 10, visited_at: "10:00", visit_content: "訪問内容" },
        ],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("DUPLICATE_REPORT");
    // 日報の作成は呼ばれないこと
    expect(mockTx.dailyReport.create).not.toHaveBeenCalled();
  });

  // DR-106: report_date 未入力
  it("DR-106: report_dateが未入力の場合は400 VALIDATION_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        status: "draft",
        visit_records: [],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const detail = body.error.details?.find(
      (d: { field: string }) => d.field === "report_date"
    );
    expect(detail).toBeDefined();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // DR-107: 訪問記録の customer_id 未入力
  it("DR-107: visit_recordsのcustomer_idが未入力の場合は400 VALIDATION_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        visit_records: [
          {
            // customer_id を省略
            visited_at: "10:00",
            visit_content: "訪問内容",
          },
        ],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const detail = body.error.details?.find((d: { field: string }) =>
      d.field.includes("customer_id")
    );
    expect(detail).toBeDefined();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // DR-108: 訪問記録の visit_content 未入力
  it("DR-108: visit_recordsのvisit_contentが空の場合は400 VALIDATION_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        visit_records: [
          {
            customer_id: 10,
            visited_at: "10:00",
            visit_content: "", // 空文字
          },
        ],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const detail = body.error.details?.find((d: { field: string }) =>
      d.field.includes("visit_content")
    );
    expect(detail).toBeDefined();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // DR-109: manager が日報を作成しようとする
  it("DR-109: managerロールでリクエストすると403 FORBIDDENを返す", async () => {
    const token = await signJwt({
      user_id: 5,
      email: "manager@example.com",
      role: "manager",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        visit_records: [
          { customer_id: 10, visited_at: "10:00", visit_content: "訪問内容" },
        ],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // DR-110: 未認証でリクエスト
  it("DR-110: Authorizationヘッダーなしでリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = makePostRequest({
      report_date: "2026-03-10",
      visit_records: [],
    }); // トークンなし

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // 追加: visit_records が空でも日報が作成できる（下書きのみ）
  it("visit_recordsが空配列でも201を返す（下書き作成）", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        status: "draft",
        visit_records: [],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.report_id).toBe(42);
    // 訪問記録は作成されないこと
    expect(mockTx.visitRecord.create).not.toHaveBeenCalled();
    expect(mockTx.visitAttendee.createMany).not.toHaveBeenCalled();
  });

  // 追加: status 省略時は draft がデフォルト
  it("statusを省略すると draft で日報が作成される", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        visit_records: [],
        // status を省略
      },
      token
    );

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockTx.dailyReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "draft" }),
      })
    );
  });

  // 追加: status が不正値の場合はバリデーションエラー
  it("statusが不正値の場合は400 VALIDATION_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        status: "pending", // 不正値
        visit_records: [],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // 追加: visited_at のフォーマット不正
  it("visited_atがHH:MM形式でない場合は400 VALIDATION_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        visit_records: [
          {
            customer_id: 10,
            visited_at: "10時00分", // 不正フォーマット
            visit_content: "訪問内容",
          },
        ],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // 追加: トランザクション内の予期しないエラーは 500 に変換される
  it("DB操作で予期しないエラーが発生した場合は500 INTERNAL_SERVER_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    mockTransaction.mockRejectedValue(new Error("DB connection error"));

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        visit_records: [],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  // [要修正-1] report_date に存在しない日付を指定すると 400
  it("report_dateに存在しない日付（2026-13-01）を指定すると400 VALIDATION_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-13-01", // 月が13で存在しない日付
        visit_records: [],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // [要修正-2] visited_at に無効な時刻を指定すると 400
  it("visited_atに無効な時刻（25:00）を指定すると400 VALIDATION_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        visit_records: [
          { customer_id: 10, visited_at: "25:00", visit_content: "訪問内容" },
        ],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // [要修正-2] visited_at に "99:99" のような明らかな不正値
  it("visited_atに99:99を指定すると400 VALIDATION_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        visit_records: [
          { customer_id: 10, visited_at: "99:99", visit_content: "訪問内容" },
        ],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // [要修正-3] P2002（ユニーク制約違反）が DUPLICATE_REPORT になる
  it("トランザクション内でP2002が発生した場合は400 DUPLICATE_REPORTを返す（競合状態対応）", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    // 実際の PrismaClientKnownRequestError インスタンスを生成
    const p2002Error = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the constraint: `daily_reports_user_id_report_date_key`",
      { code: "P2002", clientVersion: "5.0.0" }
    );
    mockTransaction.mockRejectedValue(p2002Error);

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        visit_records: [],
      },
      token
    );

    const res = await POST(req);
    const body = await res.json();

    // 同時リクエスト競合は DUPLICATE_REPORT として返ること
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("DUPLICATE_REPORT");
  });

  // [要修正-4] attendee_user_ids に重複IDを渡してもエラーにならない（デデュープ）
  it("attendee_user_idsに重複したIDを指定しても201を返し重複なしで作成される", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        visit_records: [
          {
            customer_id: 10,
            visited_at: "10:00",
            visit_content: "訪問内容",
            attendee_user_ids: [2, 3, 2], // userId=2 が重複
          },
        ],
      },
      token
    );

    const res = await POST(req);

    expect(res.status).toBe(201);
    // 重複を除いた [2, 3] で createMany が呼ばれること
    expect(mockTx.visitAttendee.createMany).toHaveBeenCalledWith({
      data: [
        { visitId: 1, userId: 2 },
        { visitId: 1, userId: 3 },
      ],
    });
  });

  // 追加: 同行者なしの場合は visitAttendee.createMany が呼ばれない
  it("attendee_user_idsが空の場合はvisitAttendee.createManyが呼ばれない", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makePostRequest(
      {
        report_date: "2026-03-10",
        visit_records: [
          { customer_id: 10, visited_at: "10:00", visit_content: "訪問内容" },
          // attendee_user_ids を省略（デフォルト []）
        ],
      },
      token
    );

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(mockTx.visitAttendee.createMany).not.toHaveBeenCalled();
  });
});
