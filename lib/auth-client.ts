/** フロントエンド用認証ユーティリティ（localStorage によるトークン管理） */

const AUTH_TOKEN_KEY = "auth_token"

/**
 * JWT トークンを localStorage に保存する。
 * サーバーサイドでは呼び出さないこと（SSR 非対応）。
 */
export function saveToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}

/**
 * localStorage から JWT トークンを取得する。
 * サーバーサイドでは null を返す。
 */
export function getToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

/**
 * localStorage から JWT トークンを削除する。
 * サーバーサイドでは呼び出さないこと。
 */
export function removeToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY)
}

/**
 * ログイン済みかどうかを判定する（トークンの存在のみ確認）。
 * サーバーサイドでは false を返す。
 */
export function isAuthenticated(): boolean {
  return getToken() !== null
}
