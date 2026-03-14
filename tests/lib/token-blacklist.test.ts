import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  addToBlacklist,
  isBlacklisted,
  clearBlacklist,
} from "@/lib/token-blacklist";
import { signJwt } from "@/lib/auth";

beforeEach(() => {
  clearBlacklist();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** 期限切れまでの残りミリ秒を計算するヘルパー */
function msUntilExpiry(exp: number): number {
  return exp * 1000 - Date.now();
}

describe("token-blacklist", () => {
  it("addToBlacklist: ブラックリストに追加したトークンはisBlacklistedがtrueを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "taro@example.com",
      role: "sales",
    });

    addToBlacklist(token);

    expect(isBlacklisted(token)).toBe(true);
  });

  it("isBlacklisted: ブラックリスト未登録のトークンはfalseを返す", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "taro@example.com",
      role: "sales",
    });

    expect(isBlacklisted(token)).toBe(false);
  });

  it("addToBlacklist: JWTの有効期限到達後にブラックリストから自動削除される", async () => {
    const token = await signJwt({
      user_id: 1,
      email: "taro@example.com",
      role: "sales",
    });

    addToBlacklist(token);
    expect(isBlacklisted(token)).toBe(true);

    // JWTのデフォルト有効期限（.env.test: 1h = 3600秒）を経過させる
    vi.advanceTimersByTime(60 * 60 * 1000 + 1000);

    expect(isBlacklisted(token)).toBe(false);
  });

  it("addToBlacklist: すでに期限切れのトークンはブラックリストに追加されない（即時削除）", async () => {
    // 過去の時刻に期限を設定するため、システム時刻を進める
    const token = await signJwt({
      user_id: 1,
      email: "taro@example.com",
      role: "sales",
    });

    // JWTの有効期限より先の未来に移動
    vi.advanceTimersByTime(60 * 60 * 1000 + 1000);

    addToBlacklist(token);

    // 期限切れトークンは即時削除されるのでfalse
    expect(isBlacklisted(token)).toBe(false);
  });

  it("clearBlacklist: ブラックリストをすべてクリアする", async () => {
    const token1 = await signJwt({
      user_id: 1,
      email: "taro@example.com",
      role: "sales",
    });
    const token2 = await signJwt({
      user_id: 2,
      email: "hanako@example.com",
      role: "manager",
    });

    addToBlacklist(token1);
    addToBlacklist(token2);
    clearBlacklist();

    expect(isBlacklisted(token1)).toBe(false);
    expect(isBlacklisted(token2)).toBe(false);
  });
});
