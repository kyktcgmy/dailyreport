import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";

// Prisma をモック
vi.mock("@/lib/prisma", () => ({
  prisma: {
    dailyReport: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    comment: { findMany: vi.fn() },
  },
}));

// token-blacklist をモック
vi.mock("@/lib/token-blacklist", () => ({
  isBlacklisted: vi.fn().mockReturnValue(false),
}));

// モック後にインポートする
import { GET } from "@/app/api/v1/daily-reports/[report_id]/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";

const mockFindUnique = vi.mocked(prisma.dailyReport.findUnique);
const mockUserFindMany = vi.mocked(prisma.user.findMany);
const mockCommentFindMany = vi.mocked(prisma.comment.findMany);
const mockIsBlacklisted = vi.mocked(isBlacklisted);

// テスト用 JWT トークン
let salesToken: string;
let managerToken: string;

const SALES_USER_ID = 1;
const MANAGER_USER_ID = 5;
const OTHER_SALES_USER_ID = 2;

beforeAll(async () => {
  salesToken = await signJwt({
    user_id: SALES_USER_ID,
    email: "sales@example.com",
    role: "sales",
  });
  managerToken = await signJwt({
    user_id: MANAGER_USER_ID,
    email: "manager@example.com",
    role: "manager",
  });
});

/** テスト用リクエストを生成するヘルパー */
function makeRequest(reportId: number | string, token: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/v1/daily-reports/${reportId}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
}

/** RouteContext の params を生成するヘルパー */
function makeParams(reportId: number | string) {
  return { params: Promise.resolve({ report_id: String(reportId) }) };
}

/** 完全な日報モックデータ */
const mockReport = {
  reportId: 42,
  userId: SALES_USER_ID,
  reportDate: new Date("2026-03-10T00:00:00.000Z"),
  status: "submitted",
  submittedAt: new Date("2026-03-10T09:00:00.000Z"),
  user: { userId: SALES_USER_ID, name: "田中太郎" },
  visitRecords: [
    {
      visitId: 101,
      customerId: 10,
      // 10:00 JST = 01:00 UTC
      visitedAt: new Date("2026-03-10T01:00:00.000Z"),
      visitContent: "製品説明",
      customer: { customerId: 10, name: "山田花子", companyName: "株式会社A" },
      attendees: [
        { visitId: 101, userId: 2, user: { userId: 2, name: "佐藤次郎" } },
      ],
    },
  ],
  problems: [{ problemId: 201, content: "課題内容", sortOrder: 1 }],
  plans: [{ planId: 401, content: "計画内容", sortOrder: 1 }],
};

/** コメントモックデータ */
const mockComments = [
  {
    commentId: 301,
    targetType: "problem",
    targetId: 201,
    userId: MANAGER_USER_ID,
    content: "コメント内容",
    createdAt: new Date("2026-03-10T10:00:00.000Z"),
    user: { userId: MANAGER_USER_ID, name: "上司A" },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockIsBlacklisted.mockReturnValue(false);

  // デフォルト: 日報あり、コメントなし、部下なし
  mockFindUnique.mockResolvedValue(mockReport as never);
  mockUserFindMany.mockResolvedValue([]);
  mockCommentFindMany.mockResolvedValue([]);
});

describe("GET /api/v1/daily-reports/:report_id", () => {
  // DR-201: 正常系 - 自分の日報詳細を取得できる（sales）
  it("DR-201: salesユーザーが自分の日報詳細を取得すると200とフルレスポンスを返す", async () => {
    mockCommentFindMany.mockResolvedValue(mockComments as never);

    const req = makeRequest(42, salesToken);
    const res = await GET(req, makeParams(42));
    const body = await res.json();

    expect(res.status).toBe(200);

    const { data } = body;
    expect(data.report_id).toBe(42);
    expect(data.report_date).toBe("2026-03-10");
    expect(data.status).toBe("submitted");
    expect(data.submitted_at).toBe("2026-03-10T09:00:00.000Z");
    expect(data.user).toEqual({ user_id: SALES_USER_ID, name: "田中太郎" });

    // 訪問記録
    expect(data.visit_records).toHaveLength(1);
    const vr = data.visit_records[0];
    expect(vr.visit_id).toBe(101);
    expect(vr.customer).toEqual({
      customer_id: 10,
      name: "山田花子",
      company_name: "株式会社A",
    });
    expect(vr.visited_at).toBe("01:00"); // UTC時刻で返る
    expect(vr.visit_content).toBe("製品説明");
    expect(vr.attendees).toEqual([{ user_id: 2, name: "佐藤次郎" }]);

    // 課題（コメント付き）
    expect(data.problems).toHaveLength(1);
    const problem = data.problems[0];
    expect(problem.problem_id).toBe(201);
    expect(problem.content).toBe("課題内容");
    expect(problem.sort_order).toBe(1);
    expect(problem.comments).toHaveLength(1);
    expect(problem.comments[0]).toEqual({
      comment_id: 301,
      commenter: { user_id: MANAGER_USER_ID, name: "上司A" },
      content: "コメント内容",
      created_at: "2026-03-10T10:00:00.000Z",
    });

    // 計画（コメントなし）
    expect(data.plans).toHaveLength(1);
    const plan = data.plans[0];
    expect(plan.plan_id).toBe(401);
    expect(plan.content).toBe("計画内容");
    expect(plan.sort_order).toBe(1);
    expect(plan.comments).toEqual([]);
  });

  // DR-202: 正常系 - 部下の日報詳細を取得できる（manager）
  it("DR-202: managerユーザーが部下の日報詳細を取得すると200を返す", async () => {
    // 部下として SALES_USER_ID を返す
    mockUserFindMany.mockResolvedValue([
      { userId: SALES_USER_ID },
    ] as never);

    const req = makeRequest(42, managerToken);
    const res = await GET(req, makeParams(42));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.report_id).toBe(42);
    expect(body.data.user.user_id).toBe(SALES_USER_ID);

    // 部下照会クエリが正しく呼ばれること
    expect(mockUserFindMany).toHaveBeenCalledWith({
      where: { managerId: MANAGER_USER_ID, deletedAt: null },
      select: { userId: true },
    });
  });

  // DR-203: 権限エラー - 他のsalesユーザーの日報は取得できない（sales）
  it("DR-203: salesユーザーが他ユーザーの日報を取得しようとすると403を返す", async () => {
    // 別のsalesユーザーの日報をモック
    mockFindUnique.mockResolvedValue({
      ...mockReport,
      userId: OTHER_SALES_USER_ID,
      user: { userId: OTHER_SALES_USER_ID, name: "別のユーザー" },
    } as never);

    const req = makeRequest(42, salesToken);
    const res = await GET(req, makeParams(42));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    // コメント取得は呼ばれないこと
    expect(mockCommentFindMany).not.toHaveBeenCalled();
  });

  // DR-204: 権限エラー - 部下でないユーザーの日報は取得できない（manager）
  it("DR-204: managerユーザーが部下でないユーザーの日報を取得しようとすると403を返す", async () => {
    // 部下なし（自分以外）、日報の所有者は SALES_USER_ID
    mockUserFindMany.mockResolvedValue([] as never);
    // 日報の userId は SALES_USER_ID で、manager 自身(5)とは異なる
    mockFindUnique.mockResolvedValue({
      ...mockReport,
      userId: SALES_USER_ID,
    } as never);

    const req = makeRequest(42, managerToken);
    const res = await GET(req, makeParams(42));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockCommentFindMany).not.toHaveBeenCalled();
  });

  // DR-205: Not Found - 存在しない日報IDを指定した場合は404を返す
  it("DR-205: 存在しない日報IDを指定すると404を返す", async () => {
    mockFindUnique.mockResolvedValue(null);

    const req = makeRequest(9999, salesToken);
    const res = await GET(req, makeParams(9999));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  // DR-206: バリデーションエラー - 無効なreport_id
  it("DR-206: report_idが文字列「abc」の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest("abc", salesToken);
    const res = await GET(req, makeParams("abc"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const detail = body.error.details?.find(
      (d: { field: string }) => d.field === "report_id"
    );
    expect(detail).toBeDefined();
    // DBへの問い合わせは発生しないこと
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("DR-206b: report_idが「0」の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest("0", salesToken);
    const res = await GET(req, makeParams("0"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("DR-206c: report_idが「-1」の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest("-1", salesToken);
    const res = await GET(req, makeParams("-1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  // 追加: managerが自分自身の日報を取得できる
  it("managerユーザーが自分自身の日報を取得すると200を返す", async () => {
    // 日報の所有者を manager 自身に設定
    mockFindUnique.mockResolvedValue({
      ...mockReport,
      userId: MANAGER_USER_ID,
      user: { userId: MANAGER_USER_ID, name: "上司A" },
    } as never);
    // 部下はいない
    mockUserFindMany.mockResolvedValue([] as never);

    const req = makeRequest(42, managerToken);
    const res = await GET(req, makeParams(42));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.user.user_id).toBe(MANAGER_USER_ID);
  });

  // 追加: draft 日報の submitted_at は null
  it("statusがdraftの日報はsubmitted_atがnullになる", async () => {
    mockFindUnique.mockResolvedValue({
      ...mockReport,
      status: "draft",
      submittedAt: null,
    } as never);

    const req = makeRequest(42, salesToken);
    const res = await GET(req, makeParams(42));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("draft");
    expect(body.data.submitted_at).toBeNull();
  });

  // 追加: visited_at が HH:MM 形式で正しくフォーマットされる
  it("visited_atはUTCのHH:MM形式で返される", async () => {
    mockFindUnique.mockResolvedValue({
      ...mockReport,
      visitRecords: [
        {
          ...mockReport.visitRecords[0],
          // 09:05 UTC
          visitedAt: new Date("2026-03-10T09:05:00.000Z"),
        },
      ],
    } as never);

    const req = makeRequest(42, salesToken);
    const res = await GET(req, makeParams(42));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.visit_records[0].visited_at).toBe("09:05");
  });

  // 追加: problem と plan 両方にコメントがある場合
  it("problemとplanの両方にコメントが存在する場合それぞれに正しく紐付けられる", async () => {
    const mixedComments = [
      {
        commentId: 301,
        targetType: "problem",
        targetId: 201,
        userId: MANAGER_USER_ID,
        content: "課題へのコメント",
        createdAt: new Date("2026-03-10T10:00:00.000Z"),
        user: { userId: MANAGER_USER_ID, name: "上司A" },
      },
      {
        commentId: 302,
        targetType: "plan",
        targetId: 401,
        userId: MANAGER_USER_ID,
        content: "計画へのコメント",
        createdAt: new Date("2026-03-10T11:00:00.000Z"),
        user: { userId: MANAGER_USER_ID, name: "上司A" },
      },
    ];
    mockCommentFindMany.mockResolvedValue(mixedComments as never);

    const req = makeRequest(42, salesToken);
    const res = await GET(req, makeParams(42));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.problems[0].comments).toHaveLength(1);
    expect(body.data.problems[0].comments[0].content).toBe("課題へのコメント");
    expect(body.data.plans[0].comments).toHaveLength(1);
    expect(body.data.plans[0].comments[0].content).toBe("計画へのコメント");
  });

  // 追加: 問題・計画がない日報（コメントクエリが発行されない）
  it("problemsとplansが空の日報はcomment.findManyが呼ばれない", async () => {
    mockFindUnique.mockResolvedValue({
      ...mockReport,
      problems: [],
      plans: [],
    } as never);

    const req = makeRequest(42, salesToken);
    const res = await GET(req, makeParams(42));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.problems).toEqual([]);
    expect(body.data.plans).toEqual([]);
    expect(mockCommentFindMany).not.toHaveBeenCalled();
  });

  // 追加: 未認証でリクエスト
  it("Authorizationヘッダーなしでリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = new NextRequest("http://localhost/api/v1/daily-reports/42", {
      method: "GET",
    });
    const res = await GET(req, makeParams(42));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  // 追加: DB エラーは 500 に変換される
  it("DB操作で予期しないエラーが発生した場合は500 INTERNAL_SERVER_ERRORを返す", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB connection error"));

    const req = makeRequest(42, salesToken);
    const res = await GET(req, makeParams(42));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
