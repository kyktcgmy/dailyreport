import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/token-blacklist", () => ({
  isBlacklisted: vi.fn().mockReturnValue(false),
}));

import { GET } from "@/app/api/v1/customers/[customer_id]/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";

const mockFindUnique = vi.mocked(prisma.customer.findUnique);
const mockIsBlacklisted = vi.mocked(isBlacklisted);

const MANAGER_USER_ID = 10;
const SALES_USER_ID = 1;

let managerToken: string;
let salesToken: string;

function makeCustomerRecord(overrides: Partial<{
  customerId: number;
  name: string;
  companyName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  createdAt: Date;
  updatedAt: Date;
  assignedUser: { userId: number; name: string } | null;
}> = {}) {
  return {
    customerId: 10,
    name: "鈴木 一郎",
    companyName: "株式会社サンプル",
    address: "東京都渋谷区1-1-1",
    phone: "03-1234-5678",
    email: "suzuki@sample.co.jp",
    createdAt: new Date("2026-01-15T09:00:00.000Z"),
    updatedAt: new Date("2026-03-01T10:00:00.000Z"),
    assignedUser: { userId: 1, name: "山田 太郎" },
    ...overrides,
  };
}

function makeRequest(customerId: string, token?: string): NextRequest {
  const url = `http://localhost/api/v1/customers/${customerId}`;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest(url, { method: "GET", headers });
}

function makeContext(customerId: string) {
  return { params: Promise.resolve({ customer_id: customerId }) };
}

beforeAll(async () => {
  managerToken = await signJwt({ user_id: MANAGER_USER_ID, email: "manager@example.com", role: "manager" });
  salesToken = await signJwt({ user_id: SALES_USER_ID, email: "sales@example.com", role: "sales" });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsBlacklisted.mockReturnValue(false);
  mockFindUnique.mockResolvedValue(makeCustomerRecord() as never);
});

describe("GET /api/v1/customers/:customer_id", () => {
  it("salesユーザーが顧客詳細を取得すると200で詳細情報を返す", async () => {
    const req = makeRequest("10", salesToken);
    const res = await GET(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.customer_id).toBe(10);
    expect(body.data.name).toBe("鈴木 一郎");
    expect(body.data.company_name).toBe("株式会社サンプル");
    expect(body.data.address).toBe("東京都渋谷区1-1-1");
    expect(body.data.phone).toBe("03-1234-5678");
    expect(body.data.email).toBe("suzuki@sample.co.jp");
    expect(body.data.assigned_user).toEqual({ user_id: 1, name: "山田 太郎" });
    expect(body.data.created_at).toBe("2026-01-15T09:00:00.000Z");
    expect(body.data.updated_at).toBe("2026-03-01T10:00:00.000Z");
  });

  it("managerユーザーも顧客詳細を取得できる", async () => {
    const req = makeRequest("10", managerToken);
    const res = await GET(req, makeContext("10"));

    expect(res.status).toBe(200);
  });

  it("assignedUserがnullの場合はassigned_userがnullで返される", async () => {
    mockFindUnique.mockResolvedValue(makeCustomerRecord({ assignedUser: null }) as never);

    const req = makeRequest("10", salesToken);
    const res = await GET(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.assigned_user).toBeNull();
  });

  it("存在しない顧客IDを指定すると404 NOT_FOUNDを返す", async () => {
    mockFindUnique.mockResolvedValue(null);

    const req = makeRequest("999", salesToken);
    const res = await GET(req, makeContext("999"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("customer_idに'abc'を指定すると400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest("abc", salesToken);
    const res = await GET(req, makeContext("abc"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("customer_id");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("customer_idに0を指定すると400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest("0", salesToken);
    const res = await GET(req, makeContext("0"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("未認証でリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = makeRequest("10");
    const res = await GET(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("DBエラー発生時は500 INTERNAL_SERVER_ERRORを返す", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB connection failed"));

    const req = makeRequest("10", salesToken);
    const res = await GET(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("addressがnullの場合はaddressフィールドがnullで返される", async () => {
    mockFindUnique.mockResolvedValue(makeCustomerRecord({ address: null }) as never);

    const req = makeRequest("10", salesToken);
    const res = await GET(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.address).toBeNull();
    expect(body.data.phone).not.toBeNull();
  });
});
