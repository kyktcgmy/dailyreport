import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signJwt } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/token-blacklist", () => ({
  isBlacklisted: vi.fn().mockReturnValue(false),
}));

import { GET } from "@/app/api/v1/users/route";
import { prisma } from "@/lib/prisma";
import { isBlacklisted } from "@/lib/token-blacklist";

const mockCount = vi.mocked(prisma.user.count);
const mockFindMany = vi.mocked(prisma.user.findMany);
const mockIsBlacklisted = vi.mocked(isBlacklisted);

const MANAGER_USER_ID = 10;
const SALES_USER_ID = 1;

let managerToken: string;
let salesToken: string;

function makeUser(overrides: Partial<{
  userId: number;
  name: string;
  email: string;
  role: "sales" | "manager";
  manager: { userId: number; name: string } | null;
}> = {}) {
  const {
    userId = 1,
    name = "山田 太郎",
    email = "taro@example.com",
    role = "sales",
    manager = { userId: 10, name: "上長 花子" },
  } = overrides;
  return { userId, name, email, role, manager };
}

function makeRequest(params: Record<string, string> = {}, token?: string): NextRequest {
  const url = new URL("http://localhost/api/v1/users");
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

describe("GET /api/v1/users", () => {
  // USR-001: managerが一覧取得
  it("USR-001: managerユーザーがリクエストすると200でユーザー一覧を返す", async () => {
    const users = [
      makeUser({ userId: 1, name: "山田 太郎", email: "taro@example.com", role: "sales" }),
      makeUser({ userId: 2, name: "田中 二郎", email: "jiro@example.com", role: "sales" }),
    ];
    mockCount.mockResolvedValue(2);
    mockFindMany.mockResolvedValue(users as never);

    const req = makeRequest({}, managerToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].user_id).toBe(1);
    expect(body.data[0].name).toBe("山田 太郎");
    expect(body.data[0].email).toBe("taro@example.com");
    expect(body.data[0].role).toBe("sales");
    expect(body.data[0].manager).toEqual({ user_id: 10, name: "上長 花子" });
    expect(body.pagination.total).toBe(2);
  });

  // USR-002: role=sales 絞り込み
  it("USR-002: role=salesクエリパラメータを指定するとsalesユーザーのみ200で返す", async () => {
    const users = [makeUser({ userId: 1, role: "sales" })];
    mockCount.mockResolvedValue(1);
    mockFindMany.mockResolvedValue(users as never);

    const req = makeRequest({ role: "sales" }, managerToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].role).toBe("sales");

    // Prismaに role 条件が渡されること
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: "sales" }),
      })
    );
  });

  // USR-003: salesがアクセス→403 FORBIDDEN
  it("USR-003: salesユーザーがリクエストすると403 FORBIDDENを返す", async () => {
    const req = makeRequest({}, salesToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("論理削除済みユーザーは除外されるよう deletedAt: null 条件が適用される", async () => {
    mockCount.mockResolvedValue(0);
    mockFindMany.mockResolvedValue([] as never);

    const req = makeRequest({}, managerToken);
    await GET(req);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("ページネーションのskip/takeが正しく計算される", async () => {
    mockCount.mockResolvedValue(25);
    mockFindMany.mockResolvedValue([] as never);

    const req = makeRequest({ page: "2", per_page: "10" }, managerToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pagination.total).toBe(25);
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.per_page).toBe(10);
    expect(body.pagination.total_pages).toBe(3); // ceil(25/10) = 3

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    );
  });

  it("managerがnullのユーザーはmanagerフィールドがnullで返される", async () => {
    const users = [makeUser({ manager: null })];
    mockCount.mockResolvedValue(1);
    mockFindMany.mockResolvedValue(users as never);

    const req = makeRequest({}, managerToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0].manager).toBeNull();
  });

  it("未認証でリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = makeRequest();
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("role=invalidは400 VALIDATION_ERRORを返す", async () => {
    const req = makeRequest({ role: "invalid" }, managerToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("DBエラー発生時は500 INTERNAL_SERVER_ERRORを返す", async () => {
    mockCount.mockRejectedValue(new Error("DB connection failed"));

    const req = makeRequest({}, managerToken);
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
