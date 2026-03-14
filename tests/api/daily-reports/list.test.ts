import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";

// Prisma をモック（DB接続なしでテスト可能にする）
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    dailyReport: { count: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

// token-blacklist をモック
vi.mock("@/lib/token-blacklist", () => ({
  addToBlacklist: vi.fn(),
  isBlacklisted: vi.fn().mockReturnValue(false),
  clearBlacklist: vi.fn(),
}));

// モック後にインポートする
import { GET } from "@/app/api/v1/daily-reports/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";

const mockUserFindMany = vi.mocked(prisma.user.findMany);
const mockDailyReportCount = vi.mocked(prisma.dailyReport.count);
const mockDailyReportFindMany = vi.mocked(prisma.dailyReport.findMany);
const mockQueryRaw = vi.mocked(prisma.$queryRaw);

/** テスト用 日報レコードのファクトリ */
function makeReport(overrides: Partial<{
  reportId: number;
  userId: number;
  reportDate: Date;
  status: "draft" | "submitted";
  submittedAt: Date | null;
  user: { userId: number; name: string };
  visitCount: number;
}> = {}) {
  const {
    reportId = 1,
    userId = 1,
    reportDate = new Date("2026-03-10T00:00:00.000Z"),
    status = "submitted",
    submittedAt = new Date("2026-03-10T09:00:00.000Z"),
    user = { userId: 1, name: "山田 太郎" },
    visitCount = 2,
  } = overrides;

  return {
    reportId,
    userId,
    reportDate,
    status,
    submittedAt,
    createdAt: new Date("2026-03-10T08:00:00.000Z"),
    updatedAt: new Date("2026-03-10T09:00:00.000Z"),
    user,
    _count: { visitRecords: visitCount },
  };
}

function makeRequest(
  params: Record<string, string> = {},
  token?: string
): NextRequest {
  const url = new URL("http://localhost/api/v1/daily-reports");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest(url.toString(), { method: "GET", headers });
}

const mockIsBlacklisted = vi.mocked(isBlacklisted);

// 各テスト前にモックをリセット
beforeEach(() => {
  vi.clearAllMocks();
  mockIsBlacklisted.mockReturnValue(false);
  // デフォルト: コメントなし
  mockQueryRaw.mockResolvedValue([]);
});

describe("GET /api/v1/daily-reports", () => {
  // DR-001: sales ユーザーが自分の日報一覧を取得
  it("DR-001: salesユーザーがパラメータなしでリクエストすると自分の日報一覧を200で返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const report = makeReport({ reportId: 1, userId: 1 });
    mockDailyReportCount.mockResolvedValue(1);
    mockDailyReportFindMany.mockResolvedValue([report] as never);

    const req = makeRequest({}, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].report_id).toBe(1);
    expect(body.data[0].user.user_id).toBe(1);
    expect(body.data[0].user.name).toBe("山田 太郎");
    expect(typeof body.data[0].visit_count).toBe("number");
    expect(typeof body.data[0].comment_count).toBe("number");

    // pagination オブジェクトが含まれること
    expect(body.pagination.total).toBe(1);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.per_page).toBe(20);
    expect(body.pagination.total_pages).toBe(1);

    // userId フィルタが自分のIDで絞られていること
    expect(mockDailyReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 1 }) })
    );
  });

  // DR-002: sales ユーザーが他ユーザーの日報を取得しようとする
  it("DR-002: salesユーザーが他ユーザーのuser_idを指定すると403 FORBIDDENを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makeRequest({ user_id: "999" }, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");

    // Prisma のデータ取得は一切呼ばれないこと
    expect(mockDailyReportCount).not.toHaveBeenCalled();
    expect(mockDailyReportFindMany).not.toHaveBeenCalled();
  });

  // DR-003: 上長が部下全員の日報一覧を取得
  it("DR-003: managerユーザーがパラメータなしでリクエストすると部下全員の日報を200で返す", async () => {
    const token = await signJwt({
      user_id: 10,
      email: "manager@example.com",
      role: "manager",
    });

    // 部下は userId=1 と userId=2
    mockUserFindMany.mockResolvedValue([
      { userId: 1 },
      { userId: 2 },
    ] as never);

    const reports = [
      makeReport({ reportId: 1, userId: 1, user: { userId: 1, name: "山田 太郎" } }),
      makeReport({ reportId: 2, userId: 2, user: { userId: 2, name: "佐藤 次郎" } }),
    ];
    mockDailyReportCount.mockResolvedValue(2);
    mockDailyReportFindMany.mockResolvedValue(reports as never);

    const req = makeRequest({}, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);

    // manager 自身(10) + 部下(1, 2) の userId で絞られていること
    expect(mockDailyReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { in: [10, 1, 2] } }),
      })
    );
  });

  // DR-004: 上長が特定の部下で絞り込み
  it("DR-004: managerユーザーが部下のuser_idを指定すると該当部下の日報のみ200で返す", async () => {
    const token = await signJwt({
      user_id: 10,
      email: "manager@example.com",
      role: "manager",
    });

    mockUserFindMany.mockResolvedValue([{ userId: 1 }] as never);

    const report = makeReport({ reportId: 1, userId: 1 });
    mockDailyReportCount.mockResolvedValue(1);
    mockDailyReportFindMany.mockResolvedValue([report] as never);

    const req = makeRequest({ user_id: "1" }, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);

    // userId が特定の部下IDで絞られていること
    expect(mockDailyReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 1 }) })
    );
  });

  // DR-005: 期間指定フィルタ
  it("DR-005: from/toを指定すると期間内の日報のみ200で返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const report = makeReport({ reportDate: new Date("2026-03-05T00:00:00.000Z") });
    mockDailyReportCount.mockResolvedValue(1);
    mockDailyReportFindMany.mockResolvedValue([report] as never);

    const req = makeRequest({ from: "2026-03-01", to: "2026-03-10" }, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);

    // reportDate の範囲フィルタが正しく適用されていること
    expect(mockDailyReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reportDate: {
            gte: new Date("2026-03-01"),
            lte: new Date("2026-03-10"),
          },
        }),
      })
    );
  });

  // DR-006: ステータスフィルタ
  it("DR-006: status=submittedを指定すると提出済み日報のみ200で返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const report = makeReport({ status: "submitted" });
    mockDailyReportCount.mockResolvedValue(1);
    mockDailyReportFindMany.mockResolvedValue([report] as never);

    const req = makeRequest({ status: "submitted" }, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);

    // status フィルタが適用されていること
    expect(mockDailyReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "submitted" }),
      })
    );
  });

  // DR-007: ページネーション
  it("DR-007: page=2, per_page=5でリクエストすると正しいpaginationオブジェクトを含む200を返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    // 総件数12件、2ページ目(5件/ページ)
    mockDailyReportCount.mockResolvedValue(12);
    mockDailyReportFindMany.mockResolvedValue([
      makeReport({ reportId: 6 }),
      makeReport({ reportId: 7 }),
    ] as never);

    const req = makeRequest({ page: "2", per_page: "5" }, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pagination.total).toBe(12);
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.per_page).toBe(5);
    expect(body.pagination.total_pages).toBe(3); // ceil(12/5) = 3

    // skip と take が正しく渡されていること
    expect(mockDailyReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 })
    );
  });

  // DR-008: 未認証でリクエスト
  it("DR-008: Authorizationヘッダーなしでリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = makeRequest(); // トークンなし

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");

    // Prisma は呼ばれないこと
    expect(mockDailyReportFindMany).not.toHaveBeenCalled();
  });

  // 追加: コメント数が正しく集計される
  it("comment_countはProblem・Planへのコメント合計件数を返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    mockDailyReportCount.mockResolvedValue(1);
    mockDailyReportFindMany.mockResolvedValue([
      makeReport({ reportId: 1 }),
    ] as never);

    // コメント数 3 件を返すモック（BigInt は Postgres raw 結果の型を模倣）
    mockQueryRaw.mockResolvedValue([
      { report_id: BigInt(1), count: BigInt(3) },
    ] as never);

    const req = makeRequest({}, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0].comment_count).toBe(3);
  });

  // 追加: 上長が部下でないユーザーのuser_idを指定すると403
  it("managerユーザーが部下でないuser_idを指定すると403 FORBIDDENを返す", async () => {
    const token = await signJwt({
      user_id: 10,
      email: "manager@example.com",
      role: "manager",
    });

    // 部下は userId=1 のみ
    mockUserFindMany.mockResolvedValue([{ userId: 1 }] as never);

    const req = makeRequest({ user_id: "999" }, token); // 部下でないID
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  // 追加: レスポンスのフィールド検証
  it("レスポンスの各フィールドが仕様通りの型と構造を持つ", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    mockDailyReportCount.mockResolvedValue(1);
    mockDailyReportFindMany.mockResolvedValue([
      makeReport({
        reportId: 42,
        status: "submitted",
        submittedAt: new Date("2026-03-10T18:00:00.000Z"),
        user: { userId: 1, name: "山田 太郎" },
        visitCount: 3,
        reportDate: new Date("2026-03-10T00:00:00.000Z"),
      }),
    ] as never);

    const req = makeRequest({}, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    const item = body.data[0];
    expect(item.report_id).toBe(42);
    expect(item.report_date).toBe("2026-03-10"); // YYYY-MM-DD 文字列
    expect(item.status).toBe("submitted");
    expect(item.submitted_at).toBe("2026-03-10T18:00:00.000Z");
    expect(item.user).toEqual({ user_id: 1, name: "山田 太郎" });
    expect(item.visit_count).toBe(3);
    expect(item.comment_count).toBe(0); // モックがデフォルト [] を返す
  });

  // 追加: draft 日報の submitted_at は null
  it("status=draftの日報のsubmitted_atはnullを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    mockDailyReportCount.mockResolvedValue(1);
    mockDailyReportFindMany.mockResolvedValue([
      makeReport({ status: "draft", submittedAt: null }),
    ] as never);

    const req = makeRequest({}, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0].status).toBe("draft");
    expect(body.data[0].submitted_at).toBeNull();
  });

  // [要修正-5] sales が自分の user_id を明示指定すると 200 が返る
  it("salesユーザーが自分のuser_idを明示指定すると200で自分の日報を返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const report = makeReport({ reportId: 1, userId: 1 });
    mockDailyReportCount.mockResolvedValue(1);
    mockDailyReportFindMany.mockResolvedValue([report] as never);

    // user_id=1 のトークンで user_id=1 を指定
    const req = makeRequest({ user_id: "1" }, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].user.user_id).toBe(1);
    // userId フィルタが自分のIDで絞られていること
    expect(mockDailyReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 1 }) })
    );
  });

  // [要修正-1] manager が自分のuser_idを指定すると200で自分の日報を返す
  it("managerユーザーが自分のuser_idを指定すると200で自分の日報を返す", async () => {
    const token = await signJwt({
      user_id: 10,
      email: "manager@example.com",
      role: "manager",
    });

    mockUserFindMany.mockResolvedValue([{ userId: 1 }] as never);

    const report = makeReport({ reportId: 5, userId: 10, user: { userId: 10, name: "上長 花子" } });
    mockDailyReportCount.mockResolvedValue(1);
    mockDailyReportFindMany.mockResolvedValue([report] as never);

    // manager 自身の user_id を指定
    const req = makeRequest({ user_id: "10" }, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(mockDailyReportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 10 }) })
    );
  });
});

// [要修正-3] バリデーション異常系テスト
describe("GET /api/v1/daily-reports - バリデーションエラー", () => {
  it("fromがYYYY-MM-DD形式でない場合は400 VALIDATION_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makeRequest({ from: "2026-3-1" }, token); // ゼロ埋めなし
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockDailyReportFindMany).not.toHaveBeenCalled();
  });

  it("toがYYYY-MM-DD形式でない場合は400 VALIDATION_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makeRequest({ to: "20260310" }, token); // ハイフンなし
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("statusが不正値の場合は400 VALIDATION_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makeRequest({ status: "invalid" }, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockDailyReportFindMany).not.toHaveBeenCalled();
  });

  it("page=0の場合は400 VALIDATION_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makeRequest({ page: "0" }, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockDailyReportFindMany).not.toHaveBeenCalled();
  });

  it("per_page=200はmax(100)超過で400 VALIDATION_ERRORを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "yamada@example.com",
      role: "sales",
    });

    const req = makeRequest({ per_page: "200" }, token);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockDailyReportFindMany).not.toHaveBeenCalled();
  });
});
