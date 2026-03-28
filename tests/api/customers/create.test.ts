import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    customer: { create: vi.fn() },
  },
}));

vi.mock("@/lib/token-blacklist", () => ({
  isBlacklisted: vi.fn().mockReturnValue(false),
}));

import { POST } from "@/app/api/v1/customers/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";

const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockCustomerCreate = vi.mocked(prisma.customer.create);
const mockIsBlacklisted = vi.mocked(isBlacklisted);

const MANAGER_USER_ID = 10;
const SALES_USER_ID = 1;

let managerToken: string;
let salesToken: string;

function makePostRequest(body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/v1/customers", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

beforeAll(async () => {
  managerToken = await signJwt({ user_id: MANAGER_USER_ID, email: "manager@example.com", role: "manager" });
  salesToken = await signJwt({ user_id: SALES_USER_ID, email: "sales@example.com", role: "sales" });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsBlacklisted.mockReturnValue(false);
  mockUserFindUnique.mockResolvedValue({ userId: 1 } as never);
  mockCustomerCreate.mockResolvedValue({ customerId: 10 } as never);
});

describe("POST /api/v1/customers", () => {
  // CST-101: 正常系 - manager が顧客を作成
  it("CST-101: managerユーザーが必須フィールドを指定して顧客を作成すると201を返す", async () => {
    const req = makePostRequest(
      { name: "鈴木 一郎", company_name: "株式会社サンプル" },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.customer_id).toBe(10);
    expect(mockCustomerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "鈴木 一郎",
          companyName: "株式会社サンプル",
        }),
      })
    );
  });

  // CST-102: 全フィールドを指定した場合
  it("CST-102: 全フィールドを指定して顧客を作成すると201を返す", async () => {
    const req = makePostRequest(
      {
        name: "田中 花子",
        company_name: "有限会社テスト",
        address: "東京都渋谷区1-1-1",
        phone: "03-9876-5432",
        email: "tanaka@test.co.jp",
        assigned_user_id: 1,
      },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.customer_id).toBe(10);

    // assigned_user_idのユーザー存在確認が呼ばれること
    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 1, deletedAt: null },
      })
    );
    expect(mockCustomerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "田中 花子",
          companyName: "有限会社テスト",
          address: "東京都渋谷区1-1-1",
          phone: "03-9876-5432",
          email: "tanaka@test.co.jp",
          assignedUserId: 1,
        }),
      })
    );
  });

  // CST-103: salesユーザーは403
  it("CST-103: salesユーザーがリクエストすると403 FORBIDDENを返す", async () => {
    const req = makePostRequest(
      { name: "鈴木 一郎", company_name: "株式会社サンプル" },
      salesToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });

  // CST-104: nameが空の場合はバリデーションエラー
  it("CST-104: nameが空文字の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makePostRequest(
      { name: "  ", company_name: "株式会社サンプル" },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });

  // CST-105: company_nameが未指定の場合はバリデーションエラー
  it("CST-105: company_nameが未指定の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makePostRequest({ name: "鈴木 一郎" }, managerToken);
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });

  it("assigned_user_idに存在しないユーザーを指定すると400 VALIDATION_ERRORを返す", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const req = makePostRequest(
      { name: "鈴木 一郎", company_name: "株式会社サンプル", assigned_user_id: 999 },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("assigned_user_id");
    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });

  it("emailが不正な形式の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makePostRequest(
      { name: "鈴木 一郎", company_name: "株式会社サンプル", email: "not-an-email" },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });

  it("未認証でリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = makePostRequest({ name: "鈴木 一郎", company_name: "株式会社サンプル" });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockCustomerCreate).not.toHaveBeenCalled();
  });

  it("DBエラー発生時は500 INTERNAL_SERVER_ERRORを返す", async () => {
    mockCustomerCreate.mockRejectedValue(new Error("DB connection failed"));

    const req = makePostRequest(
      { name: "鈴木 一郎", company_name: "株式会社サンプル" },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("assigned_user_idが未指定の場合はassignedUserIdがnullで作成される", async () => {
    const req = makePostRequest(
      { name: "鈴木 一郎", company_name: "株式会社サンプル" },
      managerToken
    );
    await POST(req);

    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockCustomerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedUserId: null }),
      })
    );
  });

  it("nameの前後の空白はtrimされて保存される", async () => {
    const req = makePostRequest(
      { name: "  鈴木 一郎  ", company_name: "株式会社サンプル" },
      managerToken
    );
    await POST(req);

    expect(mockCustomerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "鈴木 一郎" }),
      })
    );
  });
});
