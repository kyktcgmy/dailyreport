/**
 * インメモリのトークンブラックリスト
 * ログアウト済みトークンを管理する（単一プロセス内で有効）
 */
const blacklist = new Set<string>();

export function addToBlacklist(token: string): void {
  blacklist.add(token);
}

export function isBlacklisted(token: string): boolean {
  return blacklist.has(token);
}

/** テスト用クリア関数 */
export function clearBlacklist(): void {
  blacklist.clear();
}
