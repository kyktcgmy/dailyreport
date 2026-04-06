import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";

// Prisma をモック
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    dailyReport: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    customer: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    problem: { findUnique: vi.fn() },
    plan: { findUnique: vi.fn() },
    comment: { findMany: vi.fn(), create: vi.fn() },
  },
}));

// token-blacklist をモック
vi.mock("@/lib/token-blacklist", () => ({
  addToBlacklist: vi.fn(),
  isBlacklisted: vi.fn().mockReturnValue(false),
  clearBlacklist: vi.fn(),
}));

// モック後にインポートする
import { POST as postDailyReports, GET as getDailyReports } from "@/app/api/v1/daily-reports/route";
import { GET as getDailyReport, PUT as putDailyReport } from "@/app/api/v1/daily-reports/[report_id]/route";
import { POST as submitDailyReport } from "@/app/api/v1/daily-reports/[report_id]/submit/route";
import { POST as postProblemComment } from "@/app/api/v1/problems/[problem_id]/comments/route";
import { POST as postPlanComment } from "@/app/api/v1/plans/[plan_id]/comments/route";
import { GET as getCustomers, POST as postCustomer } from "@/app/api/v1/customers/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";

// ============================================================
// モックの参照
// ============================================================

const mockTransaction = vi.mocked(prisma.$transaction);
const mockQueryRaw = vi.mocked(prisma.$queryRaw);
const mockIsBlacklisted = vi.mocked(isBlacklisted);

/** トランザクション内で使う tx のモックオブジェクト */
const mockTx = {
  dailyReport: { findUnique: vi.fn(), create: vi.fn() },
  visitRecord: { create: vi.fn() },
  visitAttendee: { createMany: vi.fn() },
  problem: { createMany: vi.fn() },
  plan: { createMany: vi.fn() },
};

// ============================================================
// ヘルパー関数
// ============================================================

function makeRequest(url: string, method: string, token: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new NextRequest(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function makeCtx(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

// ============================================================
// beforeEach
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();
  mockIsBlacklisted.mockReturnValue(false);

  // トランザクションのデフォルト実装
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockTransaction.mockImplementation(async (fn: any) => fn(mockTx));

  // $queryRaw のデフォルト（GET /daily-reports のコメント件数集計）
  mockQueryRaw.mockResolvedValue([]);
});

// ============================================================
// SCN-001: 日報作成→提出→上長コメント→山田がコメント確認
// ============================================================

describe("SCN-001: 日報作成→提出→上長コメント→山田がコメント確認", () => {
  it("SCN-001: 山田が日報を作成・提出し、花子がコメントを追加、山田が詳細でコメントを確認できる", async () => {
    // ---- Step 1: 山田のトークンを取得 ----
    const yamadaToken = await signJwt({ user_id: 1, email: "yamada@example.com", role: "sales" });

    // ---- Step 2: 日報作成 ----
    const REPORT_ID = 101;
    const PROBLEM_ID = 201;
    const PLAN_ID = 401;

    mockTx.dailyReport.findUnique.mockResolvedValue(null);
    mockTx.dailyReport.create.mockResolvedValue({
      reportId: REPORT_ID,
      userId: 1,
      reportDate: new Date("2026-04-04T00:00:00.000Z"),
      status: "draft",
      submittedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockTx.visitRecord.create.mockResolvedValue({
      visitId: 1,
      reportId: REPORT_ID,
      customerId: 10,
      visitedAt: new Date("2026-04-04T10:00:00.000Z"),
      visitContent: "A社訪問",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockTx.visitAttendee.createMany.mockResolvedValue({ count: 0 });
    mockTx.problem.createMany.mockResolvedValue({ count: 1 });
    mockTx.plan.createMany.mockResolvedValue({ count: 1 });

    const createReq = makeRequest(
      "http://localhost/api/v1/daily-reports",
      "POST",
      yamadaToken,
      {
        report_date: "2026-04-04",
        status: "draft",
        visit_records: [
          { customer_id: 10, visited_at: "10:00", visit_content: "A社訪問", attendee_user_ids: [] },
        ],
        problems: [{ content: "価格交渉が難航", sort_order: 1 }],
        plans: [{ content: "見積書を再作成する", sort_order: 1 }],
      }
    );
    const createRes = await postDailyReports(createReq);
    const createBody = await createRes.json();

    expect(createRes.status).toBe(201);
    expect(createBody.data.report_id).toBe(REPORT_ID);

    // report_id を取り出して以降のリクエストに使用
    const reportId = createBody.data.report_id as number;

    // ---- Step 3: 日報を提出 ----
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue({
      userId: 1,
      status: "draft",
      _count: { visitRecords: 1 },
    } as never);
    vi.mocked(prisma.dailyReport.updateMany).mockResolvedValue({ count: 1 });

    const submitReq = makeRequest(
      `http://localhost/api/v1/daily-reports/${reportId}/submit`,
      "POST",
      yamadaToken
    );
    const submitRes = await submitDailyReport(submitReq, makeCtx({ report_id: String(reportId) }));
    const submitBody = await submitRes.json();

    expect(submitRes.status).toBe(200);
    expect(submitBody.data.report_id).toBe(reportId);
    expect(submitBody.data.status).toBe("submitted");

    // ---- Step 4: 花子（manager）のトークンを取得 ----
    const hanakoToken = await signJwt({ user_id: 5, email: "hanako@example.com", role: "manager" });

    // ---- Step 5: problem にコメント追加 ----
    const COMMENT_ID_PROBLEM = 301;

    vi.mocked(prisma.problem.findUnique).mockResolvedValue({ problemId: PROBLEM_ID } as never);
    vi.mocked(prisma.comment.create).mockResolvedValueOnce({
      commentId: COMMENT_ID_PROBLEM,
      targetType: "problem",
      targetId: PROBLEM_ID,
      userId: 5,
      content: "価格交渉については上長と相談してください",
      createdAt: new Date("2026-04-04T18:00:00.000Z"),
      user: { userId: 5, name: "花子" },
    } as never);

    const problemCommentReq = makeRequest(
      `http://localhost/api/v1/problems/${PROBLEM_ID}/comments`,
      "POST",
      hanakoToken,
      { content: "価格交渉については上長と相談してください" }
    );
    const problemCommentRes = await postProblemComment(
      problemCommentReq,
      makeCtx({ problem_id: String(PROBLEM_ID) })
    );
    const problemCommentBody = await problemCommentRes.json();

    expect(problemCommentRes.status).toBe(201);
    expect(problemCommentBody.data.comment_id).toBe(COMMENT_ID_PROBLEM);

    // comment_id を取り出す
    const problemCommentId = problemCommentBody.data.comment_id as number;

    // ---- Step 6: plan にコメント追加 ----
    const COMMENT_ID_PLAN = 302;

    vi.mocked(prisma.plan.findUnique).mockResolvedValue({ planId: PLAN_ID } as never);
    vi.mocked(prisma.comment.create).mockResolvedValueOnce({
      commentId: COMMENT_ID_PLAN,
      targetType: "plan",
      targetId: PLAN_ID,
      userId: 5,
      content: "見積書のフォーマットはテンプレートを使ってください",
      createdAt: new Date("2026-04-04T18:05:00.000Z"),
      user: { userId: 5, name: "花子" },
    } as never);

    const planCommentReq = makeRequest(
      `http://localhost/api/v1/plans/${PLAN_ID}/comments`,
      "POST",
      hanakoToken,
      { content: "見積書のフォーマットはテンプレートを使ってください" }
    );
    const planCommentRes = await postPlanComment(
      planCommentReq,
      makeCtx({ plan_id: String(PLAN_ID) })
    );

    expect(planCommentRes.status).toBe(201);

    // ---- Step 7: 山田が日報詳細を取得（コメント含む状態をモック） ----
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue({
      reportId,
      userId: 1,
      reportDate: new Date("2026-04-04T00:00:00.000Z"),
      status: "submitted",
      submittedAt: new Date("2026-04-04T09:00:00.000Z"),
      user: { userId: 1, name: "山田" },
      visitRecords: [
        {
          visitId: 1,
          customerId: 10,
          visitedAt: new Date("2026-04-04T10:00:00.000Z"),
          visitContent: "A社訪問",
          customer: { customerId: 10, name: "田中花子", companyName: "株式会社A" },
          attendees: [],
        },
      ],
      problems: [{ problemId: PROBLEM_ID, content: "価格交渉が難航", sortOrder: 1 }],
      plans: [{ planId: PLAN_ID, content: "見積書を再作成する", sortOrder: 1 }],
    } as never);

    vi.mocked(prisma.comment.findMany).mockResolvedValue([
      {
        commentId: COMMENT_ID_PROBLEM,
        targetType: "problem",
        targetId: PROBLEM_ID,
        userId: 5,
        content: "価格交渉については上長と相談してください",
        createdAt: new Date("2026-04-04T18:00:00.000Z"),
        user: { userId: 5, name: "花子" },
      },
      {
        commentId: COMMENT_ID_PLAN,
        targetType: "plan",
        targetId: PLAN_ID,
        userId: 5,
        content: "見積書のフォーマットはテンプレートを使ってください",
        createdAt: new Date("2026-04-04T18:05:00.000Z"),
        user: { userId: 5, name: "花子" },
      },
    ] as never);

    // manager の部下照会は不要（sales でアクセス）
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    const detailReq = makeRequest(
      `http://localhost/api/v1/daily-reports/${reportId}`,
      "GET",
      yamadaToken
    );
    const detailRes = await getDailyReport(detailReq, makeCtx({ report_id: String(reportId) }));
    const detailBody = await detailRes.json();

    expect(detailRes.status).toBe(200);

    // ---- Step 8: 最終アサート ----
    // problems[0].comments に花子のコメントが含まれること
    const problems = detailBody.data.problems as Array<{
      problem_id: number;
      comments: Array<{ comment_id: number; commenter: { user_id: number; name: string }; content: string }>;
    }>;
    expect(problems).toHaveLength(1);
    expect(problems[0].comments).toHaveLength(1);
    expect(problems[0].comments[0].comment_id).toBe(problemCommentId);
    expect(problems[0].comments[0].commenter.user_id).toBe(5);
    expect(problems[0].comments[0].commenter.name).toBe("花子");
    expect(problems[0].comments[0].content).toBe("価格交渉については上長と相談してください");

    // plans[0].comments にも花子のコメントが含まれること
    const plans = detailBody.data.plans as Array<{
      plan_id: number;
      comments: Array<{ comment_id: number; commenter: { user_id: number; name: string } }>;
    }>;
    expect(plans[0].comments).toHaveLength(1);
    expect(plans[0].comments[0].comment_id).toBe(COMMENT_ID_PLAN);
    expect(plans[0].comments[0].commenter.user_id).toBe(5);
  });
});

// ============================================================
// SCN-002: 下書き保存→訪問記録追加→提出→ステータス確認
// ============================================================

describe("SCN-002: 下書き保存→訪問記録追加→提出→ステータス確認", () => {
  it("SCN-002: 山田が下書きで日報を作成し、訪問記録を追加してから提出、最終的にsubmitted状態になる", async () => {
    // ---- Step 1: 山田のトークンを作成 ----
    const yamadaToken = await signJwt({ user_id: 1, email: "yamada@example.com", role: "sales" });

    // ---- Step 2: 日報を下書きで作成（訪問記録1件） ----
    const REPORT_ID = 102;

    mockTx.dailyReport.findUnique.mockResolvedValue(null);
    mockTx.dailyReport.create.mockResolvedValue({
      reportId: REPORT_ID,
      userId: 1,
      reportDate: new Date("2026-04-04T00:00:00.000Z"),
      status: "draft",
      submittedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockTx.visitRecord.create.mockResolvedValue({
      visitId: 1,
      reportId: REPORT_ID,
      customerId: 10,
      visitedAt: new Date("2026-04-04T10:00:00.000Z"),
      visitContent: "A社 初回訪問",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockTx.visitAttendee.createMany.mockResolvedValue({ count: 0 });
    mockTx.problem.createMany.mockResolvedValue({ count: 0 });
    mockTx.plan.createMany.mockResolvedValue({ count: 0 });

    const createReq = makeRequest(
      "http://localhost/api/v1/daily-reports",
      "POST",
      yamadaToken,
      {
        report_date: "2026-04-04",
        status: "draft",
        visit_records: [
          { customer_id: 10, visited_at: "10:00", visit_content: "A社 初回訪問", attendee_user_ids: [] },
        ],
      }
    );
    const createRes = await postDailyReports(createReq);
    const createBody = await createRes.json();

    expect(createRes.status).toBe(201);
    expect(createBody.data.report_id).toBe(REPORT_ID);

    const reportId = createBody.data.report_id as number;

    // ---- Step 3: PUT で訪問記録を2件に更新 ----
    // PUT ハンドラ用モック: findUnique（早期チェック）+ $transaction（PUT 内）
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue({
      reportId,
      userId: 1,
      status: "draft",
    } as never);

    const putMockTx = {
      visitRecord: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      visitAttendee: { createMany: vi.fn(), deleteMany: vi.fn() },
      problem: { createMany: vi.fn(), deleteMany: vi.fn() },
      plan: { createMany: vi.fn(), deleteMany: vi.fn() },
      dailyReport: { updateMany: vi.fn() },
    };
    putMockTx.visitRecord.findMany.mockResolvedValue([{ visitId: 1 }]);
    putMockTx.visitRecord.create
      .mockResolvedValueOnce({ visitId: 2, reportId, customerId: 10, visitedAt: new Date(), visitContent: "", createdAt: new Date(), updatedAt: new Date() })
      .mockResolvedValueOnce({ visitId: 3, reportId, customerId: 11, visitedAt: new Date(), visitContent: "", createdAt: new Date(), updatedAt: new Date() });
    putMockTx.visitAttendee.deleteMany.mockResolvedValue({ count: 0 });
    putMockTx.visitAttendee.createMany.mockResolvedValue({ count: 0 });
    putMockTx.visitRecord.deleteMany.mockResolvedValue({ count: 1 });
    putMockTx.problem.deleteMany.mockResolvedValue({ count: 0 });
    putMockTx.problem.createMany.mockResolvedValue({ count: 0 });
    putMockTx.plan.deleteMany.mockResolvedValue({ count: 0 });
    putMockTx.plan.createMany.mockResolvedValue({ count: 0 });
    putMockTx.dailyReport.updateMany.mockResolvedValue({ count: 1 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementationOnce(async (fn: any) => fn(putMockTx));

    const putReq = makeRequest(
      `http://localhost/api/v1/daily-reports/${reportId}`,
      "PUT",
      yamadaToken,
      {
        report_date: "2026-04-04",
        status: "draft",
        visit_records: [
          { customer_id: 10, visited_at: "10:00", visit_content: "A社 追加訪問", attendee_user_ids: [] },
          { customer_id: 11, visited_at: "14:00", visit_content: "B社 初回訪問", attendee_user_ids: [] },
        ],
      }
    );
    const putRes = await putDailyReport(putReq, makeCtx({ report_id: String(reportId) }));
    const putBody = await putRes.json();

    expect(putRes.status).toBe(200);
    expect(putBody.data.report_id).toBe(reportId);

    // ---- Step 4: 日報を提出 ----
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue({
      userId: 1,
      status: "draft",
      _count: { visitRecords: 2 },
    } as never);
    vi.mocked(prisma.dailyReport.updateMany).mockResolvedValue({ count: 1 });

    const submitReq = makeRequest(
      `http://localhost/api/v1/daily-reports/${reportId}/submit`,
      "POST",
      yamadaToken
    );
    const submitRes = await submitDailyReport(submitReq, makeCtx({ report_id: String(reportId) }));
    const submitBody = await submitRes.json();

    expect(submitRes.status).toBe(200);
    expect(submitBody.data.status).toBe("submitted");

    // ---- Step 5: 日報詳細を取得（submitted 状態をモック） ----
    const submittedAt = new Date("2026-04-04T09:30:00.000Z");
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue({
      reportId,
      userId: 1,
      reportDate: new Date("2026-04-04T00:00:00.000Z"),
      status: "submitted",
      submittedAt,
      user: { userId: 1, name: "山田" },
      visitRecords: [
        {
          visitId: 2,
          customerId: 10,
          visitedAt: new Date("2026-04-04T10:00:00.000Z"),
          visitContent: "A社 追加訪問",
          customer: { customerId: 10, name: "田中花子", companyName: "株式会社A" },
          attendees: [],
        },
        {
          visitId: 3,
          customerId: 11,
          visitedAt: new Date("2026-04-04T14:00:00.000Z"),
          visitContent: "B社 初回訪問",
          customer: { customerId: 11, name: "佐藤次郎", companyName: "株式会社B" },
          attendees: [],
        },
      ],
      problems: [],
      plans: [],
    } as never);
    vi.mocked(prisma.comment.findMany).mockResolvedValue([]);

    const detailReq = makeRequest(
      `http://localhost/api/v1/daily-reports/${reportId}`,
      "GET",
      yamadaToken
    );
    const detailRes = await getDailyReport(detailReq, makeCtx({ report_id: String(reportId) }));
    const detailBody = await detailRes.json();

    expect(detailRes.status).toBe(200);

    // ---- Step 6: 最終アサート ----
    // status === "submitted" かつ submitted_at が non-null
    expect(detailBody.data.status).toBe("submitted");
    expect(detailBody.data.submitted_at).not.toBeNull();
    expect(detailBody.data.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // 訪問記録が2件であること（PUT 後の状態）
    expect(detailBody.data.visit_records).toHaveLength(2);
  });
});

// ============================================================
// SCN-003: 顧客登録→一覧で確認→その顧客で日報作成
// ============================================================

describe("SCN-003: 顧客登録→一覧で確認→その顧客で日報作成", () => {
  it("SCN-003: 花子が顧客を登録し、山田が一覧でその顧客を確認後、その顧客で日報を作成できる", async () => {
    // ---- Step 1: 花子（manager）のトークンを作成 ----
    const hanakoToken = await signJwt({ user_id: 5, email: "hanako@example.com", role: "manager" });

    // ---- Step 2: 顧客を登録 ----
    const CUSTOMER_ID = 50;

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null); // assigned_user_id 未指定なのでこのモックは使われない
    vi.mocked(prisma.customer.create).mockResolvedValue({ customerId: CUSTOMER_ID } as never);

    const createCustomerReq = makeRequest(
      "http://localhost/api/v1/customers",
      "POST",
      hanakoToken,
      { name: "高橋商事 担当者", company_name: "高橋商事株式会社" }
    );
    const createCustomerRes = await postCustomer(createCustomerReq);
    const createCustomerBody = await createCustomerRes.json();

    expect(createCustomerRes.status).toBe(201);
    expect(createCustomerBody.data.customer_id).toBe(CUSTOMER_ID);

    // customer_id を取り出す
    const customerId = createCustomerBody.data.customer_id as number;

    // ---- Step 3: 山田（sales）のトークンを作成 ----
    const yamadaToken = await signJwt({ user_id: 1, email: "yamada@example.com", role: "sales" });

    // ---- Step 4: 顧客一覧を取得（登録した顧客を含む状態をモック） ----
    vi.mocked(prisma.customer.count).mockResolvedValue(3);
    vi.mocked(prisma.customer.findMany).mockResolvedValue([
      {
        customerId: 10,
        name: "既存顧客A",
        companyName: "既存会社A",
        phone: null,
        email: null,
        assignedUser: null,
      },
      {
        customerId: 20,
        name: "既存顧客B",
        companyName: "既存会社B",
        phone: null,
        email: null,
        assignedUser: null,
      },
      {
        customerId,
        name: "高橋商事 担当者",
        companyName: "高橋商事株式会社",
        phone: null,
        email: null,
        assignedUser: null,
      },
    ] as never);

    const getCustomersReq = makeRequest(
      "http://localhost/api/v1/customers",
      "GET",
      yamadaToken
    );
    const getCustomersRes = await getCustomers(getCustomersReq);
    const getCustomersBody = await getCustomersRes.json();

    expect(getCustomersRes.status).toBe(200);

    // ---- Step 5: 一覧に登録した顧客が含まれること ----
    const customerList = getCustomersBody.data as Array<{ customer_id: number; name: string; company_name: string }>;
    const foundCustomer = customerList.find((c) => c.customer_id === customerId);
    expect(foundCustomer).toBeDefined();
    expect(foundCustomer!.name).toBe("高橋商事 担当者");
    expect(foundCustomer!.company_name).toBe("高橋商事株式会社");

    // ---- Step 6: その customer_id を使って日報作成 ----
    const REPORT_ID = 103;

    mockTx.dailyReport.findUnique.mockResolvedValue(null);
    mockTx.dailyReport.create.mockResolvedValue({
      reportId: REPORT_ID,
      userId: 1,
      reportDate: new Date("2026-04-05T00:00:00.000Z"),
      status: "draft",
      submittedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockTx.visitRecord.create.mockResolvedValue({
      visitId: 10,
      reportId: REPORT_ID,
      customerId,
      visitedAt: new Date("2026-04-05T11:00:00.000Z"),
      visitContent: "高橋商事 初回訪問",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockTx.visitAttendee.createMany.mockResolvedValue({ count: 0 });
    mockTx.problem.createMany.mockResolvedValue({ count: 0 });
    mockTx.plan.createMany.mockResolvedValue({ count: 0 });

    // $transaction を再設定（clearAllMocks でリセットされているため）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (fn: any) => fn(mockTx));

    const createReportReq = makeRequest(
      "http://localhost/api/v1/daily-reports",
      "POST",
      yamadaToken,
      {
        report_date: "2026-04-05",
        status: "draft",
        visit_records: [
          {
            customer_id: customerId,
            visited_at: "11:00",
            visit_content: "高橋商事 初回訪問",
            attendee_user_ids: [],
          },
        ],
      }
    );
    const createReportRes = await postDailyReports(createReportReq);
    const createReportBody = await createReportRes.json();

    // ---- Step 7: 最終アサート ----
    // 日報が正常に作成されること（201, report_id 返却）
    expect(createReportRes.status).toBe(201);
    expect(createReportBody.data.report_id).toBe(REPORT_ID);
    // 正しい customer_id で訪問記録が作成されること
    expect(mockTx.visitRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId }),
      })
    );
  });
});

// ============================================================
// SCN-004: 複数営業が日報提出→上長が一覧確認→各日報にコメント
// ============================================================

describe("SCN-004: 複数営業が日報提出→上長が一覧確認→各日報にコメント", () => {
  it("SCN-004: 山田・佐藤がそれぞれ日報を提出し、花子が一覧で確認後、各日報の問題にコメントを追加できる", async () => {
    // ---- Step 1: 山田・佐藤のトークンを作成 ----
    const yamadaToken = await signJwt({ user_id: 1, email: "yamada@example.com", role: "sales" });
    const satoToken = await signJwt({ user_id: 2, email: "sato@example.com", role: "sales" });

    const REPORT_ID_YAMADA = 201;
    const REPORT_ID_SATO = 202;
    const PROBLEM_ID_YAMADA = 501;
    const PROBLEM_ID_SATO = 502;

    // ---- Step 2: 山田で日報作成 ----
    mockTx.dailyReport.findUnique.mockResolvedValue(null);
    mockTx.dailyReport.create.mockResolvedValueOnce({
      reportId: REPORT_ID_YAMADA,
      userId: 1,
      reportDate: new Date("2026-04-04T00:00:00.000Z"),
      status: "draft",
      submittedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockTx.visitRecord.create.mockResolvedValue({
      visitId: 100,
      reportId: REPORT_ID_YAMADA,
      customerId: 10,
      visitedAt: new Date("2026-04-04T10:00:00.000Z"),
      visitContent: "山田の訪問",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockTx.visitAttendee.createMany.mockResolvedValue({ count: 0 });
    mockTx.problem.createMany.mockResolvedValue({ count: 1 });
    mockTx.plan.createMany.mockResolvedValue({ count: 0 });

    const yamadaCreateReq = makeRequest(
      "http://localhost/api/v1/daily-reports",
      "POST",
      yamadaToken,
      {
        report_date: "2026-04-04",
        status: "draft",
        visit_records: [
          { customer_id: 10, visited_at: "10:00", visit_content: "山田の訪問", attendee_user_ids: [] },
        ],
        problems: [{ content: "山田の課題", sort_order: 1 }],
      }
    );
    const yamadaCreateRes = await postDailyReports(yamadaCreateReq);
    const yamadaCreateBody = await yamadaCreateRes.json();

    expect(yamadaCreateRes.status).toBe(201);
    expect(yamadaCreateBody.data.report_id).toBe(REPORT_ID_YAMADA);
    const reportIdYamada = yamadaCreateBody.data.report_id as number;

    // ---- Step 3: 山田で提出 ----
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValueOnce({
      userId: 1,
      status: "draft",
      _count: { visitRecords: 1 },
    } as never);
    vi.mocked(prisma.dailyReport.updateMany).mockResolvedValueOnce({ count: 1 });

    const yamadaSubmitReq = makeRequest(
      `http://localhost/api/v1/daily-reports/${reportIdYamada}/submit`,
      "POST",
      yamadaToken
    );
    const yamadaSubmitRes = await submitDailyReport(
      yamadaSubmitReq,
      makeCtx({ report_id: String(reportIdYamada) })
    );
    const yamadaSubmitBody = await yamadaSubmitRes.json();

    expect(yamadaSubmitRes.status).toBe(200);
    expect(yamadaSubmitBody.data.status).toBe("submitted");

    // ---- Step 4: 佐藤で日報作成 ----
    // $transaction をリセットして佐藤の日報を作成
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransaction.mockImplementation(async (fn: any) => fn(mockTx));

    mockTx.dailyReport.findUnique.mockResolvedValue(null);
    mockTx.dailyReport.create.mockResolvedValueOnce({
      reportId: REPORT_ID_SATO,
      userId: 2,
      reportDate: new Date("2026-04-04T00:00:00.000Z"),
      status: "draft",
      submittedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockTx.visitRecord.create.mockResolvedValue({
      visitId: 101,
      reportId: REPORT_ID_SATO,
      customerId: 11,
      visitedAt: new Date("2026-04-04T11:00:00.000Z"),
      visitContent: "佐藤の訪問",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const satoCreateReq = makeRequest(
      "http://localhost/api/v1/daily-reports",
      "POST",
      satoToken,
      {
        report_date: "2026-04-04",
        status: "draft",
        visit_records: [
          { customer_id: 11, visited_at: "11:00", visit_content: "佐藤の訪問", attendee_user_ids: [] },
        ],
        problems: [{ content: "佐藤の課題", sort_order: 1 }],
      }
    );
    const satoCreateRes = await postDailyReports(satoCreateReq);
    const satoCreateBody = await satoCreateRes.json();

    expect(satoCreateRes.status).toBe(201);
    expect(satoCreateBody.data.report_id).toBe(REPORT_ID_SATO);
    const reportIdSato = satoCreateBody.data.report_id as number;

    // ---- Step 5: 佐藤で提出 ----
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValueOnce({
      userId: 2,
      status: "draft",
      _count: { visitRecords: 1 },
    } as never);
    vi.mocked(prisma.dailyReport.updateMany).mockResolvedValueOnce({ count: 1 });

    const satoSubmitReq = makeRequest(
      `http://localhost/api/v1/daily-reports/${reportIdSato}/submit`,
      "POST",
      satoToken
    );
    const satoSubmitRes = await submitDailyReport(
      satoSubmitReq,
      makeCtx({ report_id: String(reportIdSato) })
    );
    const satoSubmitBody = await satoSubmitRes.json();

    expect(satoSubmitRes.status).toBe(200);
    expect(satoSubmitBody.data.status).toBe("submitted");

    // ---- Step 6: 花子（manager）のトークンを作成 ----
    const hanakoToken = await signJwt({ user_id: 5, email: "hanako@example.com", role: "manager" });

    // ---- Step 7: 花子が日報一覧を取得（山田・佐藤の2件を含む状態をモック） ----
    // manager として部下（userId: 1, 2）を取得
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { userId: 1 },
      { userId: 2 },
    ] as never);

    vi.mocked(prisma.dailyReport.count).mockResolvedValue(2);
    vi.mocked(prisma.dailyReport.findMany).mockResolvedValue([
      {
        reportId: reportIdYamada,
        reportDate: new Date("2026-04-04T00:00:00.000Z"),
        status: "submitted",
        submittedAt: new Date("2026-04-04T09:00:00.000Z"),
        user: { userId: 1, name: "山田" },
        _count: { visitRecords: 1 },
      },
      {
        reportId: reportIdSato,
        reportDate: new Date("2026-04-04T00:00:00.000Z"),
        status: "submitted",
        submittedAt: new Date("2026-04-04T10:00:00.000Z"),
        user: { userId: 2, name: "佐藤" },
        _count: { visitRecords: 1 },
      },
    ] as never);

    // $queryRaw（コメント件数集計）は空を返す
    mockQueryRaw.mockResolvedValue([]);

    const getListReq = makeRequest(
      "http://localhost/api/v1/daily-reports?from=2026-04-04&to=2026-04-04",
      "GET",
      hanakoToken
    );
    const getListRes = await getDailyReports(getListReq);
    const getListBody = await getListRes.json();

    expect(getListRes.status).toBe(200);

    // ---- Step 8: 一覧に山田・佐藤の日報が両方含まれること ----
    const reportList = getListBody.data as Array<{ report_id: number; user: { user_id: number; name: string } }>;
    expect(reportList).toHaveLength(2);

    const yamadaReport = reportList.find((r) => r.user.user_id === 1);
    const satoReport = reportList.find((r) => r.user.user_id === 2);

    expect(yamadaReport).toBeDefined();
    expect(yamadaReport!.report_id).toBe(reportIdYamada);
    expect(satoReport).toBeDefined();
    expect(satoReport!.report_id).toBe(reportIdSato);

    // ---- Step 9: 山田の日報の problem にコメント ----
    const COMMENT_ID_YAMADA = 601;
    vi.mocked(prisma.problem.findUnique).mockResolvedValueOnce({ problemId: PROBLEM_ID_YAMADA } as never);
    vi.mocked(prisma.comment.create).mockResolvedValueOnce({
      commentId: COMMENT_ID_YAMADA,
      targetType: "problem",
      targetId: PROBLEM_ID_YAMADA,
      userId: 5,
      content: "山田の課題を確認しました",
      createdAt: new Date("2026-04-04T19:00:00.000Z"),
      user: { userId: 5, name: "花子" },
    } as never);

    const yamadaCommentReq = makeRequest(
      `http://localhost/api/v1/problems/${PROBLEM_ID_YAMADA}/comments`,
      "POST",
      hanakoToken,
      { content: "山田の課題を確認しました" }
    );
    const yamadaCommentRes = await postProblemComment(
      yamadaCommentReq,
      makeCtx({ problem_id: String(PROBLEM_ID_YAMADA) })
    );
    const yamadaCommentBody = await yamadaCommentRes.json();

    expect(yamadaCommentRes.status).toBe(201);
    expect(yamadaCommentBody.data.comment_id).toBe(COMMENT_ID_YAMADA);

    // ---- Step 10: 佐藤の日報の problem にコメント ----
    const COMMENT_ID_SATO = 602;
    vi.mocked(prisma.problem.findUnique).mockResolvedValueOnce({ problemId: PROBLEM_ID_SATO } as never);
    vi.mocked(prisma.comment.create).mockResolvedValueOnce({
      commentId: COMMENT_ID_SATO,
      targetType: "problem",
      targetId: PROBLEM_ID_SATO,
      userId: 5,
      content: "佐藤の課題を確認しました",
      createdAt: new Date("2026-04-04T19:10:00.000Z"),
      user: { userId: 5, name: "花子" },
    } as never);

    const satoCommentReq = makeRequest(
      `http://localhost/api/v1/problems/${PROBLEM_ID_SATO}/comments`,
      "POST",
      hanakoToken,
      { content: "佐藤の課題を確認しました" }
    );
    const satoCommentRes = await postProblemComment(
      satoCommentReq,
      makeCtx({ problem_id: String(PROBLEM_ID_SATO) })
    );
    const satoCommentBody = await satoCommentRes.json();

    expect(satoCommentRes.status).toBe(201);
    expect(satoCommentBody.data.comment_id).toBe(COMMENT_ID_SATO);

    // ---- Step 11: 最終アサート ----
    // 両コメントが 201 で返却され comment_id を持つこと
    expect(yamadaCommentBody.data.comment_id).toBe(COMMENT_ID_YAMADA);
    expect(typeof yamadaCommentBody.data.comment_id).toBe("number");
    expect(satoCommentBody.data.comment_id).toBe(COMMENT_ID_SATO);
    expect(typeof satoCommentBody.data.comment_id).toBe("number");

    // 両コメントの commenter が花子であること
    expect(yamadaCommentBody.data.commenter.user_id).toBe(5);
    expect(satoCommentBody.data.commenter.user_id).toBe(5);

    // 両コメントの内容が正しいこと
    expect(yamadaCommentBody.data.content).toBe("山田の課題を確認しました");
    expect(satoCommentBody.data.content).toBe("佐藤の課題を確認しました");
  });
});
