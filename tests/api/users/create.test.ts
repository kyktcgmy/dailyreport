import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/token-blacklist", () => ({
  isBlacklisted: vi.fn().mockReturnValue(false),
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2b$10$hashedpassword"),
  },
}));

import { POST } from "@/app/api/v1/users/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";
import bcrypt from "bcryptjs";

const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockUserCreate = vi.mocked(prisma.user.create);
const mockIsBlacklisted = vi.mocked(isBlacklisted);
const mockBcryptHash = vi.mocked(bcrypt.hash);

const MANAGER_USER_ID = 10;
const SALES_USER_ID = 1;

let managerToken: string;
let salesToken: string;

function makePostRequest(body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/v1/users", {
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
  mockUserFindUnique.mockResolvedValue({ userId: MANAGER_USER_ID } as never);
  mockUserCreate.mockResolvedValue({ userId: 5 } as never);
  mockBcryptHash.mockResolvedValue("$2b$10$hashedpassword" as never);
});

describe("POST /api/v1/users", () => {
  // USR-101: salesユーザー正常登録 (role=sales + manager_id)
  it("USR-101: role=sales かつ manager_id を指定して登録すると201を返す", async () => {
    const req = makePostRequest(
      { name: "山田 太郎", email: "taro@example.com", password: "password123", role: "sales", manager_id: MANAGER_USER_ID },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.user_id).toBe(5);
    expect(mockUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "山田 太郎",
          email: "taro@example.com",
          role: "sales",
          manager: { connect: { userId: MANAGER_USER_ID } },
          passwordHash: "$2b$10$hashedpassword",
        }),
      })
    );
  });

  // USR-102: managerユーザー正常登録 (role=manager, manager_id不要)
  it("USR-102: role=manager で manager_id を省略して登録すると201を返す", async () => {
    const req = makePostRequest(
      { name: "上長 花子", email: "hanako@example.com", password: "pass4567", role: "manager" },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.user_id).toBe(5);
    expect(mockUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "manager",
          manager: undefined,
        }),
      })
    );
  });

  // USR-103: salesロールでmanager_id省略→400 VALIDATION_ERROR
  it("USR-103: role=sales で manager_id を省略すると400 VALIDATION_ERRORを返す", async () => {
    const req = makePostRequest(
      { name: "山田 太郎", email: "taro@example.com", password: "password123", role: "sales" },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("manager_id");
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  // USR-104: 重複メールアドレス→400 VALIDATION_ERROR
  it("USR-104: 既に登録済みのメールアドレスを指定すると400 VALIDATION_ERRORを返す", async () => {
    const duplicateError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`email`)",
      { code: "P2002", clientVersion: "5.0.0", meta: { target: ["email"] } }
    );
    mockUserCreate.mockRejectedValue(duplicateError);

    const req = makePostRequest(
      { name: "山田 太郎", email: "duplicate@example.com", password: "password123", role: "sales", manager_id: MANAGER_USER_ID },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("email");
  });

  // USR-105: salesが登録しようとする→403 FORBIDDEN
  it("USR-105: salesユーザーが登録しようとすると403 FORBIDDENを返す", async () => {
    const req = makePostRequest(
      { name: "山田 太郎", email: "taro@example.com", password: "password123", role: "sales", manager_id: MANAGER_USER_ID },
      salesToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("パスワードはbcryptでハッシュ化されてDBに保存される", async () => {
    const req = makePostRequest(
      { name: "山田 太郎", email: "taro@example.com", password: "mySecret", role: "sales", manager_id: MANAGER_USER_ID },
      managerToken
    );
    await POST(req);

    expect(mockBcryptHash).toHaveBeenCalledWith("mySecret", 10);
    expect(mockUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ passwordHash: "$2b$10$hashedpassword" }),
      })
    );
  });

  it("manager_idに存在しないユーザーを指定すると400 VALIDATION_ERRORを返す", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const req = makePostRequest(
      { name: "山田 太郎", email: "taro@example.com", password: "password123", role: "sales", manager_id: 999 },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("manager_id");
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("manager_idにsalesロールのユーザーを指定すると400 VALIDATION_ERRORを返す", async () => {
    // role: "manager" 条件に一致しないため findUnique が null を返す
    mockUserFindUnique.mockResolvedValue(null);

    const req = makePostRequest(
      { name: "山田 太郎", email: "taro@example.com", password: "password123", role: "sales", manager_id: SALES_USER_ID },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("manager_id");
    expect(mockUserCreate).not.toHaveBeenCalled();

    // role: "manager" 条件が WHERE 句に含まれること
    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: "manager" }),
      })
    );
  });

  it("passwordが7文字以下の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makePostRequest(
      { name: "山田 太郎", email: "taro@example.com", password: "short7", role: "sales", manager_id: MANAGER_USER_ID },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("未認証でリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = makePostRequest(
      { name: "山田 太郎", email: "taro@example.com", password: "password123", role: "sales", manager_id: MANAGER_USER_ID }
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("emailが不正な形式の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makePostRequest(
      { name: "山田 太郎", email: "not-an-email", password: "password123", role: "sales", manager_id: MANAGER_USER_ID },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("DBエラー発生時は500 INTERNAL_SERVER_ERRORを返す", async () => {
    mockUserCreate.mockRejectedValue(new Error("DB connection failed"));

    const req = makePostRequest(
      { name: "山田 太郎", email: "taro@example.com", password: "password123", role: "sales", manager_id: MANAGER_USER_ID },
      managerToken
    );
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
