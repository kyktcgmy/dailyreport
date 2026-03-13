import { describe, it, expect } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { signJwt } from "../../lib/auth";
import {
  withAuth,
  withRole,
  withSalesRole,
  withManagerRole,
  validateRequestBody,
  validateQueryParams,
  type AuthenticatedRequest,
} from "../../lib/api-handler";

function makeRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {}
): NextRequest {
  const init: RequestInit = { method: options.method ?? "GET" };
  if (options.body) {
    init.body = JSON.stringify(options.body);
    init.headers = { "Content-Type": "application/json", ...options.headers };
  } else if (options.headers) {
    init.headers = options.headers;
  }
  return new NextRequest(url, init);
}

const dummyCtx = { params: Promise.resolve({}) };

describe("withAuth", () => {
  it("有効なトークンで認証済みリクエストとしてハンドラーを呼び出す", async () => {
    const token = await signJwt({ user_id: 1, email: "taro@example.com", role: "sales" });
    const req = makeRequest("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    let capturedUser: AuthenticatedRequest["user"] | null = null;
    const handler = withAuth(async (req) => {
      capturedUser = req.user;
      return NextResponse.json({ ok: true });
    });

    const res = await handler(req, dummyCtx);
    expect(res.status).toBe(200);
    expect(capturedUser).not.toBeNull();
    expect(capturedUser!.user_id).toBe(1);
    expect(capturedUser!.role).toBe("sales");
  });

  it("トークンなしで 401 を返す", async () => {
    const req = makeRequest("http://localhost/api/test");
    const handler = withAuth(async () => NextResponse.json({ ok: true }));

    const res = await handler(req, dummyCtx);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("不正なトークンで 401 を返す", async () => {
    const req = makeRequest("http://localhost/api/test", {
      headers: { Authorization: "Bearer invalid.token" },
    });
    const handler = withAuth(async () => NextResponse.json({ ok: true }));

    const res = await handler(req, dummyCtx);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("withRole", () => {
  it("許可されたロールのユーザーはアクセスできる", async () => {
    const token = await signJwt({ user_id: 5, email: "hanako@example.com", role: "manager" });
    const req = makeRequest("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const handler = withRole(["manager"], async () => NextResponse.json({ ok: true }));
    const res = await handler(req, dummyCtx);

    expect(res.status).toBe(200);
  });

  it("salesユーザーがmanager専用エンドポイントにアクセスすると 403 を返す", async () => {
    const token = await signJwt({ user_id: 1, email: "taro@example.com", role: "sales" });
    const req = makeRequest("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const handler = withRole(["manager"], async () => NextResponse.json({ ok: true }));
    const res = await handler(req, dummyCtx);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("withSalesRole", () => {
  it("salesユーザーはアクセスできる", async () => {
    const token = await signJwt({ user_id: 1, email: "taro@example.com", role: "sales" });
    const req = makeRequest("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const handler = withSalesRole(async () => NextResponse.json({ ok: true }));
    const res = await handler(req, dummyCtx);

    expect(res.status).toBe(200);
  });

  it("managerユーザーがsales専用エンドポイントにアクセスすると 403 を返す", async () => {
    const token = await signJwt({ user_id: 5, email: "hanako@example.com", role: "manager" });
    const req = makeRequest("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const handler = withSalesRole(async () => NextResponse.json({ ok: true }));
    const res = await handler(req, dummyCtx);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("withManagerRole", () => {
  it("managerユーザーはアクセスできる", async () => {
    const token = await signJwt({ user_id: 5, email: "hanako@example.com", role: "manager" });
    const req = makeRequest("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const handler = withManagerRole(async () => NextResponse.json({ ok: true }));
    const res = await handler(req, dummyCtx);

    expect(res.status).toBe(200);
  });
});

describe("validateRequestBody", () => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  it("正常なボディはバリデーションを通過する", async () => {
    const req = makeRequest("http://localhost/api/test", {
      method: "POST",
      body: { email: "taro@example.com", password: "password123" },
    });

    const result = await validateRequestBody(req, schema);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ email: "taro@example.com", password: "password123" });
  });

  it("不正なemailでバリデーションエラーを返す", async () => {
    const req = makeRequest("http://localhost/api/test", {
      method: "POST",
      body: { email: "not-an-email", password: "password123" },
    });

    const result = await validateRequestBody(req, schema);

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    const body = await result.error!.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toBe("email");
  });

  it("必須フィールド欠落でバリデーションエラーを返す", async () => {
    const req = makeRequest("http://localhost/api/test", {
      method: "POST",
      body: { email: "taro@example.com" },
    });

    const result = await validateRequestBody(req, schema);

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    const body = await result.error!.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("validateQueryParams", () => {
  const schema = z.object({
    page: z.coerce.number().int().positive().optional().default(1),
    per_page: z.coerce.number().int().positive().optional().default(20),
  });

  it("クエリパラメータが正常にパースされる", () => {
    const req = makeRequest("http://localhost/api/test?page=2&per_page=10");

    const result = validateQueryParams(req, schema);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ page: 2, per_page: 10 });
  });

  it("デフォルト値が適用される", () => {
    const req = makeRequest("http://localhost/api/test");

    const result = validateQueryParams(req, schema);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ page: 1, per_page: 20 });
  });

  it("不正な値でバリデーションエラーを返す", () => {
    const req = makeRequest("http://localhost/api/test?page=-1");

    const result = validateQueryParams(req, schema);

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
  });
});
