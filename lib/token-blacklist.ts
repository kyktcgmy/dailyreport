/**
 * インメモリのトークンブラックリスト
 * ログアウト済みトークンを管理する（単一プロセス内で有効）
 * JWTのexp클레임に基づき、トークン有効期限後に自動削除してメモリリークを防止する
 */
import { decodeJwt } from "jose";

const blacklist = new Set<string>();

export function addToBlacklist(token: string): void {
  blacklist.add(token);

  try {
    const { exp } = decodeJwt(token);
    if (typeof exp === "number") {
      const msUntilExpiry = exp * 1000 - Date.now();
      if (msUntilExpiry > 0) {
        setTimeout(() => blacklist.delete(token), msUntilExpiry);
      } else {
        // すでに期限切れのトークンは即座に削除
        blacklist.delete(token);
      }
    }
  } catch {
    // デコードに失敗した場合はブラックリストに残したままにする
  }
}

export function isBlacklisted(token: string): boolean {
  return blacklist.has(token);
}

/** テスト用クリア関数 */
export function clearBlacklist(): void {
  blacklist.clear();
}
