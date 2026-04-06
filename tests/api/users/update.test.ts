import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/token-blacklist", () => ({
  isBlacklisted: vi.fn().mockReturnValue(false),
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2b$10$newhashedpassword"),
  },
}));

import { PUT } from "@/app/api/v1/users/[user_id]/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";
import bcrypt from "bcryptjs";

const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockUserUpdate = vi.mocked(prisma.user.update);
const mockIsBlacklisted = vi.mocked(isBlacklisted);
const mockBcryptHash = vi.mocked(bcrypt.hash);

const MANAGER_USER_ID = 10;
const SALES_USER_ID = 1;

let managerToken: string;
let salesToken: string;

function makePutRequest(userId: string, body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest(`http://localhost/api/v1/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers,
  });
}

function makeContext(userId: string) {
  return { params: Promise.resolve({ user_id: userId }) };
}

beforeAll(async () => {
  managerToken = await signJwt({ user_id: MANAGER_USER_ID, email: "manager@example.com", role: "manager" });
  salesToken = await signJwt({ user_id: SALES_USER_ID, email: "sales@example.com", role: "sales" });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsBlacklisted.mockReturnValue(false);
  // findUnique は2回呼ばれる可能性があるので両方成功するようにデフォルト設定
  mockUserFindUnique.mockResolvedValue({ userId: 1 } as never);
  mockUserUpdate.mockResolvedValue({ userId: 1 } as never);
  mockBcryptHash.mockResolvedValue("$2b$10$newhashedpassword" as never);
});

describe("PUT /api/v1/users/:user_id", () => {
  // USR-201: 正常更新（password指定あり）→ passwordHash が含まれること
  it("USR-201: password を指定して更新すると200を返し、passwordHash がupdateデータに含まれる", async () => {
    const req = makePutRequest(
      "1",
      { name: "山田 太郎 更新", email: "taro_new@example.com", password: "newpassword", role: "sales", manager_id: MANAGER_USER_ID },
      managerToken
    );
    const res = await PUT(req, makeContext("1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.user_id).toBe(1);

    expect(mockBcryptHash).toHaveBeenCalledWith("newpassword", 10);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "山田 太郎 更新",
          email: "taro_new@example.com",
          passwordHash: "$2b$10$newhashedpassword",
        }),
      })
    );
  });

  // USR-202: 正常更新（password省略）→ passwordHash が含まれないこと
  it("USR-202: password を省略して更新すると200を返し、passwordHash がupdateデータに含まれない", async () => {
    const req = makePutRequest(
      "1",
      { name: "山田 太郎 更新", email: "taro_new@example.com", role: "sales", manager_id: MANAGER_USER_ID },
      managerToken
    );
    const res = await PUT(req, makeContext("1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.user_id).toBe(1);

    expect(mockBcryptHash).not.toHaveBeenCalled();
    const updateCall = mockUserUpdate.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty("passwordHash");
  });

  // USR-203: salesが更新しようとする→403 FORBIDDEN
  it("USR-203: salesユーザーが更新しようとすると403 FORBIDDENを返す", async () => {
    const req = makePutRequest(
      "1",
      { name: "山田 太郎", email: "taro@example.com", role: "sales", manager_id: MANAGER_USER_ID },
      salesToken
    );
    const res = await PUT(req, makeContext("1"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("存在しないユーザーIDを指定すると404 NOT_FOUNDを返す", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const req = makePutRequest(
      "999",
      { name: "存在しない", email: "none@example.com", role: "sales", manager_id: MANAGER_USER_ID },
      managerToken
    );
    const res = await PUT(req, makeContext("999"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("role=salesでmanager_idを省略すると400 VALIDATION_ERRORを返す", async () => {
    const req = makePutRequest(
      "1",
      { name: "山田 太郎", email: "taro@example.com", role: "sales" },
      managerToken
    );
    const res = await PUT(req, makeContext("1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("manager_id");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("manager_idにsalesロールのユーザーを指定すると400 VALIDATION_ERRORを返す", async () => {
    // 1回目（対象ユーザー存在確認）は成功、2回目（manager_id確認）はrole不一致でnull
    mockUserFindUnique
      .mockResolvedValueOnce({ userId: 1 } as never)
      .mockResolvedValueOnce(null);

    const req = makePutRequest(
      "1",
      { name: "山田 太郎", email: "taro@example.com", role: "sales", manager_id: SALES_USER_ID },
      managerToken
    );
    const res = await PUT(req, makeContext("1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("manager_id");
    expect(mockUserUpdate).not.toHaveBeenCalled();

    // role: "manager" 条件が WHERE 句に含まれること
    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: "manager" }),
      })
    );
  });

  it("passwordが7文字以下の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makePutRequest(
      "1",
      { name: "山田 太郎", email: "taro@example.com", password: "short7", role: "sales", manager_id: MANAGER_USER_ID },
      managerToken
    );
    const res = await PUT(req, makeContext("1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("メールアドレス重複で更新した場合は400 VALIDATION_ERRORを返す", async () => {
    const duplicateError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`email`)",
      { code: "P2002", clientVersion: "5.0.0", meta: { target: ["email"] } }
    );
    mockUserUpdate.mockRejectedValue(duplicateError);

    const req = makePutRequest(
      "1",
      { name: "山田 太郎", email: "duplicate@example.com", role: "sales", manager_id: MANAGER_USER_ID },
      managerToken
    );
    const res = await PUT(req, makeContext("1"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("email");
  });

  it("未認証でリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = makePutRequest(
      "1",
      { name: "山田 太郎", email: "taro@example.com", role: "sales", manager_id: MANAGER_USER_ID }
    );
    const res = await PUT(req, makeContext("1"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("DBエラー発生時は500 INTERNAL_SERVER_ERRORを返す", async () => {
    mockUserUpdate.mockRejectedValue(new Error("DB connection failed"));

    const req = makePutRequest(
      "1",
      { name: "山田 太郎", email: "taro@example.com", role: "sales", manager_id: MANAGER_USER_ID },
      managerToken
    );
    const res = await PUT(req, makeContext("1"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
