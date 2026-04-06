import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/token-blacklist", () => ({
  isBlacklisted: vi.fn().mockReturnValue(false),
}));

import { DELETE } from "@/app/api/v1/customers/[customer_id]/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";

const mockCustomerFindUnique = vi.mocked(prisma.customer.findUnique);
const mockCustomerDelete = vi.mocked(prisma.customer.delete);
const mockIsBlacklisted = vi.mocked(isBlacklisted);

const MANAGER_USER_ID = 10;
const SALES_USER_ID = 1;

let managerToken: string;
let salesToken: string;

function makeDeleteRequest(customerId: string, token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest(`http://localhost/api/v1/customers/${customerId}`, {
    method: "DELETE",
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
  mockCustomerDelete.mockResolvedValue({ customerId: 10 } as never);
});

describe("DELETE /api/v1/customers/:customer_id", () => {
  // CST-301: 正常系 - manager が顧客を削除
  it("CST-301: managerユーザーが顧客を削除すると204 No Contentを返す", async () => {
    const req = makeDeleteRequest("10", managerToken);
    const res = await DELETE(req, makeContext("10"));

    expect(res.status).toBe(204);
    // 204 No Content はボディを持たない
    const text = await res.text();
    expect(text).toBe("");

    expect(mockCustomerDelete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 10 } })
    );
  });

  // CST-302: salesユーザーは403
  it("CST-302: salesユーザーがリクエストすると403 FORBIDDENを返す", async () => {
    const req = makeDeleteRequest("10", salesToken);
    const res = await DELETE(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockCustomerDelete).not.toHaveBeenCalled();
  });

  // CST-303: 存在しない顧客IDを指定すると404
  it("CST-303: 存在しない顧客IDを指定すると404 NOT_FOUNDを返す", async () => {
    mockCustomerFindUnique.mockResolvedValue(null);

    const req = makeDeleteRequest("999", managerToken);
    const res = await DELETE(req, makeContext("999"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(mockCustomerDelete).not.toHaveBeenCalled();
  });

  it("customer_idに'abc'を指定すると400 VALIDATION_ERRORを返す", async () => {
    const req = makeDeleteRequest("abc", managerToken);
    const res = await DELETE(req, makeContext("abc"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("customer_id");
    expect(mockCustomerDelete).not.toHaveBeenCalled();
  });

  it("customer_idに0を指定すると400 VALIDATION_ERRORを返す", async () => {
    const req = makeDeleteRequest("0", managerToken);
    const res = await DELETE(req, makeContext("0"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockCustomerDelete).not.toHaveBeenCalled();
  });

  it("未認証でリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = makeDeleteRequest("10");
    const res = await DELETE(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockCustomerDelete).not.toHaveBeenCalled();
  });

  it("DBエラー発生時は500 INTERNAL_SERVER_ERRORを返す", async () => {
    mockCustomerDelete.mockRejectedValue(new Error("DB connection failed"));

    const req = makeDeleteRequest("10", managerToken);
    const res = await DELETE(req, makeContext("10"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("削除前に顧客の存在確認が行われる", async () => {
    const req = makeDeleteRequest("10", managerToken);
    await DELETE(req, makeContext("10"));

    expect(mockCustomerFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 10 } })
    );
    expect(mockCustomerDelete).toHaveBeenCalled();
  });
});
