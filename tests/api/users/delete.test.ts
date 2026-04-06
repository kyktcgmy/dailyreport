import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";

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

import { DELETE } from "@/app/api/v1/users/[user_id]/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";

const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockUserUpdate = vi.mocked(prisma.user.update);
const mockIsBlacklisted = vi.mocked(isBlacklisted);

const MANAGER_USER_ID = 10;
const OTHER_USER_ID = 5;
const SALES_USER_ID = 1;

let managerToken: string;
let salesToken: string;

function makeDeleteRequest(userId: string, token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest(`http://localhost/api/v1/users/${userId}`, {
    method: "DELETE",
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
  mockUserFindUnique.mockResolvedValue({ userId: OTHER_USER_ID } as never);
  mockUserUpdate.mockResolvedValue({ userId: OTHER_USER_ID } as never);
});

describe("DELETE /api/v1/users/:user_id", () => {
  // USR-301: 他ユーザーの論理削除→204
  it("USR-301: managerユーザーが他ユーザーを削除すると204 No Contentを返す", async () => {
    const req = makeDeleteRequest(String(OTHER_USER_ID), managerToken);
    const res = await DELETE(req, makeContext(String(OTHER_USER_ID)));

    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe("");

    // 論理削除（deletedAt に現在時刻をセット）が呼ばれること
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: OTHER_USER_ID },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
  });

  // USR-302: 自分自身の削除→403 CANNOT_DELETE_SELF
  it("USR-302: 自分自身を削除しようとすると403 CANNOT_DELETE_SELFを返す", async () => {
    const req = makeDeleteRequest(String(MANAGER_USER_ID), managerToken);
    const res = await DELETE(req, makeContext(String(MANAGER_USER_ID)));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("CANNOT_DELETE_SELF");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  // USR-303: salesが削除しようとする→403 FORBIDDEN
  it("USR-303: salesユーザーが削除しようとすると403 FORBIDDENを返す", async () => {
    const req = makeDeleteRequest(String(OTHER_USER_ID), salesToken);
    const res = await DELETE(req, makeContext(String(OTHER_USER_ID)));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("存在しないユーザーIDを指定すると404 NOT_FOUNDを返す", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const req = makeDeleteRequest("999", managerToken);
    const res = await DELETE(req, makeContext("999"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("物理削除ではなく論理削除（deletedAt を現在時刻にセット）であることを確認", async () => {
    const req = makeDeleteRequest(String(OTHER_USER_ID), managerToken);
    const before = new Date();
    await DELETE(req, makeContext(String(OTHER_USER_ID)));
    const after = new Date();

    const call = mockUserUpdate.mock.calls[0][0];
    const deletedAt = (call.data as { deletedAt: Date }).deletedAt;
    expect(deletedAt).toBeInstanceOf(Date);
    expect(deletedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(deletedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("削除前に論理削除済みでないことの確認が行われる（deletedAt: null 条件）", async () => {
    const req = makeDeleteRequest(String(OTHER_USER_ID), managerToken);
    await DELETE(req, makeContext(String(OTHER_USER_ID)));

    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: OTHER_USER_ID, deletedAt: null }),
      })
    );
  });

  it("user_idに'abc'を指定すると400 VALIDATION_ERRORを返す", async () => {
    const req = makeDeleteRequest("abc", managerToken);
    const res = await DELETE(req, makeContext("abc"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("user_id");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("未認証でリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = makeDeleteRequest(String(OTHER_USER_ID));
    const res = await DELETE(req, makeContext(String(OTHER_USER_ID)));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("DBエラー発生時は500 INTERNAL_SERVER_ERRORを返す", async () => {
    mockUserUpdate.mockRejectedValue(new Error("DB connection failed"));

    const req = makeDeleteRequest(String(OTHER_USER_ID), managerToken);
    const res = await DELETE(req, makeContext(String(OTHER_USER_ID)));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
