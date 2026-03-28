import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/token-blacklist", () => ({
  isBlacklisted: vi.fn().mockReturnValue(false),
}));

import { GET } from "@/app/api/v1/users/[user_id]/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";

const mockUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockIsBlacklisted = vi.mocked(isBlacklisted);

const MANAGER_USER_ID = 10;
const SALES_USER_ID = 1;

let managerToken: string;
let salesToken: string;

function makeGetRequest(userId: string, token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest(`http://localhost/api/v1/users/${userId}`, {
    method: "GET",
    headers,
  });
}

function makeContext(userId: string) {
  return { params: Promise.resolve({ user_id: userId }) };
}

const NOW = new Date("2026-01-15T09:00:00.000Z");

beforeAll(async () => {
  managerToken = await signJwt({ user_id: MANAGER_USER_ID, email: "manager@example.com", role: "manager" });
  salesToken = await signJwt({ user_id: SALES_USER_ID, email: "sales@example.com", role: "sales" });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsBlacklisted.mockReturnValue(false);
  mockUserFindUnique.mockResolvedValue({
    userId: 1,
    name: "山田 太郎",
    email: "taro@example.com",
    role: "sales",
    createdAt: NOW,
    updatedAt: NOW,
    manager: { userId: 10, name: "上長 花子" },
  } as never);
});

describe("GET /api/v1/users/:user_id", () => {
  it("managerユーザーが有効なIDで取得すると200でユーザー詳細を返す", async () => {
    const req = makeGetRequest("1", managerToken);
    const res = await GET(req, makeContext("1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.user_id).toBe(1);
    expect(body.data.name).toBe("山田 太郎");
    expect(body.data.email).toBe("taro@example.com");
    expect(body.data.role).toBe("sales");
    expect(body.data.manager).toEqual({ user_id: 10, name: "上長 花子" });
    expect(body.data.created_at).toBe(NOW.toISOString());
    expect(body.data.updated_at).toBe(NOW.toISOString());
  });

  it("managerがnullのユーザーはmanagerフィールドがnullで返される", async () => {
    mockUserFindUnique.mockResolvedValue({
      userId: 2,
      name: "上長 次郎",
      email: "jiro@example.com",
      role: "manager",
      createdAt: NOW,
      updatedAt: NOW,
      manager: null,
    } as never);

    const req = makeGetRequest("2", managerToken);
    const res = await GET(req, makeContext("2"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.manager).toBeNull();
  });

  it("存在しないユーザーIDを指定すると404 NOT_FOUNDを返す", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const req = makeGetRequest("999", managerToken);
    const res = await GET(req, makeContext("999"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("論理削除済みユーザーは404 NOT_FOUNDを返す（deletedAt: null 条件でfindUnique）", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const req = makeGetRequest("5", managerToken);
    await GET(req, makeContext("5"));

    // deletedAt: null 条件が渡されることを確認
    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 5, deletedAt: null }),
      })
    );
  });

  it("salesユーザーがリクエストすると403 FORBIDDENを返す", async () => {
    const req = makeGetRequest("1", salesToken);
    const res = await GET(req, makeContext("1"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("user_idに'abc'を指定すると400 VALIDATION_ERRORを返す", async () => {
    const req = makeGetRequest("abc", managerToken);
    const res = await GET(req, makeContext("abc"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("user_id");
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("未認証でリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = makeGetRequest("1");
    const res = await GET(req, makeContext("1"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("DBエラー発生時は500 INTERNAL_SERVER_ERRORを返す", async () => {
    mockUserFindUnique.mockRejectedValue(new Error("DB connection failed"));

    const req = makeGetRequest("1", managerToken);
    const res = await GET(req, makeContext("1"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
