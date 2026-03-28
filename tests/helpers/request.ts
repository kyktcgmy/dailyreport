/**
 * APIリクエストヘルパー
 *
 * Next.js の Route Handler を直接呼び出すのではなく、
 * 起動中のサーバーに対して fetch を発行するシンプルなラッパー。
 * 統合テストで使用する。
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

/**
 * /api/v1 配下のエンドポイントへリクエストを送る。
 *
 * @param path   "/daily-reports" のようなパス（先頭スラッシュあり）
 * @param options メソッド・認証トークン・リクエストボディなど
 */
export async function apiRequest<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const { method = "GET", token, body, headers: extraHeaders = {} } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}/api/v1${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const responseBody = await response.json().catch(() => null);

  return {
    status: response.status,
    body: responseBody as T,
    headers: response.headers,
  };
}
