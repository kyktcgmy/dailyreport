import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { signJwt } from "@/lib/auth";
import { isBlacklisted } from "@/lib/token-blacklist";
import { withAuth, type AuthenticatedRequest } from "@/lib/api-handler";

// token-blacklist をモックして副作用なしにテスト
vi.mock("@/lib/token-blacklist", () => ({
  addToBlacklist: vi.fn(),
  isBlacklisted: vi.fn().mockReturnValue(false),
  clearBlacklist: vi.fn(),
}));

// モック後にインポート
import { POST } from "@/app/api/v1/auth/logout/route";

const mockIsBlacklisted = vi.mocked(isBlacklisted);

function makeLogoutRequest(token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return new NextRequest("http://localhost/api/v1/auth/logout", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // デフォルトはブラックリスト未登録
  mockIsBlacklisted.mockReturnValue(false);
});

describe("POST /api/v1/auth/logout", () => {
  // AUTH-101: 正常ログアウト
  it("AUTH-101: 有効なトークンでログアウトすると204を返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "taro@example.com",
      role: "sales",
    });
    const req = makeLogoutRequest(token);

    const res = await POST(req);

    expect(res.status).toBe(204);
    // レスポンスボディなし
    expect(res.body).toBeNull();
  });

  // AUTH-102: 未認証でリクエスト
  it("AUTH-102: トークンなしでリクエストすると401 UNAUTHORIZEDを返す", async () => {
    const req = makeLogoutRequest(); // Authorizationヘッダーなし

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

// AUTH-103: ブラックリスト済みトークンへのアクセス拒否
// withAuth がブラックリスト済みトークンを正しく拒否することを検証
describe("withAuth - ブラックリスト済みトークンの拒否", () => {
  it("AUTH-103: ログアウト済みトークンでAPIにアクセスすると401 UNAUTHORIZEDを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "taro@example.com",
      role: "sales",
    });

    // ブラックリスト登録済みとしてモック設定
    mockIsBlacklisted.mockReturnValue(true);

    const req = new NextRequest("http://localhost/api/v1/some-endpoint", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const dummyCtx = { params: Promise.resolve({}) };

    // withAuth で保護された任意のハンドラー（ログアウト後のアクセス想定）
    const handler = withAuth(async (_req: AuthenticatedRequest) =>
      NextResponse.json({ ok: true })
    );

    const res = await handler(req, dummyCtx);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    // ブラックリストチェックが実際に呼ばれたこと
    expect(mockIsBlacklisted).toHaveBeenCalledWith(token);
  });
});
