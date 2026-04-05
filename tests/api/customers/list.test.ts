import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/token-blacklist", () => ({
  isBlacklisted: vi.fn().mockReturnValue(false),
}));

import { GET } from "@/app/api/v1/customers/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";

const mockCount = vi.mocked(prisma.customer.count);
const mockFindMany = vi.mocked(prisma.customer.findMany);
const mockIsBlacklisted = vi.mocked(isBlacklisted);

const MANAGER_USER_ID = 10;
const SALES_USER_ID = 1;

let managerToken: string;
let salesToken: string;

/** テスト用 顧客レコードのファクトリ */
function makeCustomer(overrides: Partial<{
  customerId: number;
  name: string;
  companyName: string;
  phone: string | null;
  email: string | null;
  assignedUser: { userId: number; name: string } | null;
}> = {}) {
  const {
    customerId = 1,
    name = "鈴木 一郎",
    companyName = "株式会社サンプル",
    phone = "03-1234-5678",
    email = "suzuki@sample.co.jp",
    assignedUser = { userId: 1, name: "山田 太郎" },
  } = overrides;

  return { customerId, name, companyName, phone, email, assignedUser };
}

function makeRequest(params: Record<string, string> = {}, token?: string): NextRequest {
  const url = new URL("http://localhost/api/v1/customers");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest(url.toString(), { method: "GET", headers });
}

beforeAll(async () => {
  managerToken = await signJwt({ user_id: MANAGER_USER_ID, email: "manager@example.com", role: "manager" });
  salesToken = await signJwt({ user_id: SALES_USER_ID, email: "sales@example.com", role: "sales" });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsBlacklisted.mockReturnValue(false);
  mockCount.mockResolvedValue(0);
  mockFindMany.mockResolvedValue([] as never);
});

describe("GET /api/v1/customers", () => {
  // CST-001: salesユーザーが顧客一覧を取得
  it("CST-001: salesユーザーがリクエストすると顧客一覧を200で返す", async () => {
    const customers = [makeCustomer({ customerId: 10 })];
    mockCount.mockResolvedValue(1);
    mockFindMany.mockResolvedValue(customers as never);

    const req = makeRequest({}, salesToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].customer_id).toBe(10);
    expect(body.data[0].name).toBe("鈴木 一郎");
    expect(body.data[0].company_name).toBe("株式会社サンプル");
    expect(body.data[0].assigned_user).toEqual({ user_id: 1, name: "山田 太郎" });
  });

  it("managerユーザーがリクエストすると顧客一覧を200で返す", async () => {
    const customers = [makeCustomer({ customerId: 10 }), makeCustomer({ customerId: 11, name: "田中 花子", companyName: "株式会社テスト" })];
    mockCount.mockResolvedValue(2);
    mockFindMany.mockResolvedValue(customers as never);

    const req = makeRequest({}, managerToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
  });

  // CST-002: 顧客名で部分一致検索
  it("CST-002: nameクエリパラメータを指定するとcontains条件で絞り込まれる", async () => {
    const customer = makeCustomer({ name: "鈴木 一郎" });
    mockCount.mockResolvedValue(1);
    mockFindMany.mockResolvedValue([customer] as never);

    const req = makeRequest({ name: "鈴木" }, salesToken);
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ name: { contains: "鈴木" } }),
      })
    );
  });

  // CST-003: 会社名で部分一致検索
  it("CST-003: company_nameクエリパラメータを指定するとcontains条件で絞り込まれる", async () => {
    const customer = makeCustomer({ companyName: "株式会社サンプル" });
    mockCount.mockResolvedValue(1);
    mockFindMany.mockResolvedValue([customer] as never);

    const req = makeRequest({ company_name: "サンプル" }, salesToken);
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyName: { contains: "サンプル" } }),
      })
    );
  });

  // CST-004: 担当営業で絞り込み
  it("CST-004: assigned_user_idを指定すると担当営業で絞り込まれる", async () => {
    const customer = makeCustomer({ assignedUser: { userId: 3, name: "佐藤 次郎" } });
    mockCount.mockResolvedValue(1);
    mockFindMany.mockResolvedValue([customer] as never);

    const req = makeRequest({ assigned_user_id: "3" }, salesToken);
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assignedUserId: 3 }),
      })
    );
  });

  // CST-005: 未認証でリクエストすると401 UNAUTHORIZED
  it("CST-005: 未認証でリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = makeRequest(); // トークンなし

    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("page=2, per_page=5でリクエストすると正しいpaginationオブジェクトを200で返す", async () => {
    mockCount.mockResolvedValue(12);
    mockFindMany.mockResolvedValue([makeCustomer({ customerId: 6 }), makeCustomer({ customerId: 7 })] as never);

    const req = makeRequest({ page: "2", per_page: "5" }, salesToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pagination.total).toBe(12);
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.per_page).toBe(5);
    expect(body.pagination.total_pages).toBe(3); // ceil(12/5) = 3

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 })
    );
  });

  it("assigned_userがnullの顧客はassigned_userフィールドがnullで返される", async () => {
    const customer = makeCustomer({ assignedUser: null });
    mockCount.mockResolvedValue(1);
    mockFindMany.mockResolvedValue([customer] as never);

    const req = makeRequest({}, salesToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0].assigned_user).toBeNull();
  });

  it("per_page=200はmax(100)超過で400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest({ per_page: "200" }, salesToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("page=0の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest({ page: "0" }, salesToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("DBエラー発生時は500 INTERNAL_SERVER_ERRORを返す", async () => {
    mockCount.mockRejectedValue(new Error("DB connection failed"));

    const req = makeRequest({}, salesToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

});
