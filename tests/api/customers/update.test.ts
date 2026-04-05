import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    customer: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/token-blacklist", () => ({
  isBlacklisted: vi.fn().mockReturnValue(false),
}));

import { PUT } from "@/app/api/v1/customers/[customer_id]/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";

const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockCustomerFindUnique = vi.mocked(prisma.customer.findUnique);
const mockCustomerUpdate = vi.mocked(prisma.customer.update);
const mockIsBlacklisted = vi.mocked(isBlacklisted);

const MANAGER_USER_ID = 10;
const SALES_USER_ID = 1;

let managerToken: string;
let salesToken: string;

function makePutRequest(customerId: string, body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest(`http://localhost/api/v1/customers/${customerId}`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers,
  });
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
  mockCustomerFindUnique.mockResolvedValue({ customerId: 10 } as never);
  mockUserFindUnique.mockResolvedValue({ userId: 1 } as never);
  mockCustomerUpdate.mockResolvedValue({ customerId: 10 } as never);
});

describe("PUT /api/v1/customers/:customer_id", () => {
  // CST-201: 正常系 - manager が顧客を更新
  it("CST-201: managerユーザーが顧客を更新すると200で customer_id を返す", async () => {
    const req = makePutRequest(
      "10",
      { name: "鈴木 二郎", company_name: "株式会社更新後" },
      managerToken
    );
    const res = await PUT(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.customer_id).toBe(10);
    expect(mockCustomerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: 10 },
        data: expect.objectContaining({
          name: "鈴木 二郎",
          companyName: "株式会社更新後",
        }),
      })
    );
  });

  // CST-202: salesユーザーは403
  it("CST-202: salesユーザーがリクエストすると403 FORBIDDENを返す", async () => {
    const req = makePutRequest(
      "10",
      { name: "鈴木 一郎", company_name: "株式会社サンプル" },
      salesToken
    );
    const res = await PUT(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockCustomerUpdate).not.toHaveBeenCalled();
  });

  // CST-203: 存在しない顧客IDは404 NOT_FOUND
  it("CST-203: 存在しない顧客IDを指定すると404 NOT_FOUNDを返す", async () => {
    mockCustomerFindUnique.mockResolvedValue(null);

    const req = makePutRequest(
      "999",
      { name: "鈴木 一郎", company_name: "株式会社サンプル" },
      managerToken
    );
    const res = await PUT(req, makeContext("999"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(mockCustomerUpdate).not.toHaveBeenCalled();
  });

  it("assigned_user_idが未指定の場合はassignedUserIdがnullにセットされる", async () => {
    const req = makePutRequest(
      "10",
      { name: "鈴木 一郎", company_name: "株式会社サンプル" },
      managerToken
    );
    await PUT(req, makeContext("10"));

    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockCustomerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedUserId: null }),
      })
    );
  });

  it("customer_idに'abc'を指定すると400 VALIDATION_ERRORを返す", async () => {
    const req = makePutRequest(
      "abc",
      { name: "鈴木 一郎", company_name: "株式会社サンプル" },
      managerToken
    );
    const res = await PUT(req, makeContext("abc"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("customer_id");
    expect(mockCustomerUpdate).not.toHaveBeenCalled();
  });

  it("assigned_user_idに存在しないユーザーを指定すると400 VALIDATION_ERRORを返す", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const req = makePutRequest(
      "10",
      { name: "鈴木 一郎", company_name: "株式会社サンプル", assigned_user_id: 999 },
      managerToken
    );
    const res = await PUT(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("assigned_user_id");
    expect(mockCustomerUpdate).not.toHaveBeenCalled();
  });

  it("nameが空文字の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makePutRequest(
      "10",
      { name: "", company_name: "株式会社サンプル" },
      managerToken
    );
    const res = await PUT(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockCustomerUpdate).not.toHaveBeenCalled();
  });

  it("未認証でリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = makePutRequest("10", { name: "鈴木 一郎", company_name: "株式会社サンプル" });
    const res = await PUT(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockCustomerUpdate).not.toHaveBeenCalled();
  });

  it("DBエラー発生時は500 INTERNAL_SERVER_ERRORを返す", async () => {
    mockCustomerUpdate.mockRejectedValue(new Error("DB connection failed"));

    const req = makePutRequest(
      "10",
      { name: "鈴木 一郎", company_name: "株式会社サンプル" },
      managerToken
    );
    const res = await PUT(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("assigned_user_idが指定された場合はユーザー存在確認が行われる", async () => {
    const req = makePutRequest(
      "10",
      { name: "鈴木 一郎", company_name: "株式会社サンプル", assigned_user_id: 5 },
      managerToken
    );
    await PUT(req, makeContext("10"));

    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 5, deletedAt: null },
      })
    );
  });
});
