import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

// Prismaモジュールをモック（DB接続なしでテスト可能にする）
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// モック後にインポートする
import { POST } from "@/app/api/v1/auth/login/route";
import { prisma } from "@/lib/prisma";

const mockFindUnique = vi.mocked(prisma.user.findUnique);

function makeLoginRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const PASSWORD = "password123";
let hashedPassword: string;

// テスト前にbcryptでハッシュを生成（ハードコード禁止）
beforeEach(async () => {
  if (!hashedPassword) {
    hashedPassword = await bcrypt.hash(PASSWORD, 10);
  }
  vi.clearAllMocks();
});

describe("POST /api/v1/auth/login", () => {
  // AUTH-001: 正常ログイン（営業）
  it("AUTH-001: salesユーザーが正しい認証情報でログインすると200とトークンを返す", async () => {
    mockFindUnique.mockResolvedValue({
      userId: 1,
      name: "山田 太郎",
      email: "yamada@example.com",
      role: "sales",
      passwordHash: hashedPassword,
      deletedAt: null,
    });

    const req = makeLoginRequest({
      email: "yamada@example.com",
      password: PASSWORD,
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.token).toBeTruthy();
    expect(typeof body.data.token).toBe("string");
    expect(body.data.user.user_id).toBe(1);
    expect(body.data.user.email).toBe("yamada@example.com");
    expect(body.data.user.role).toBe("sales");
    expect(body.data.user.name).toBe("山田 太郎");
    // パスワードハッシュはレスポンスに含まれないこと
    expect(body.data.user.passwordHash).toBeUndefined();
    expect(body.data.user.password_hash).toBeUndefined();
  });

  // AUTH-002: 正常ログイン（上長）
  it("AUTH-002: managerユーザーが正しい認証情報でログインすると200とrole=managerのトークンを返す", async () => {
    mockFindUnique.mockResolvedValue({
      userId: 5,
      name: "上長 花子",
      email: "hanako@example.com",
      role: "manager",
      passwordHash: hashedPassword,
      deletedAt: null,
    });

    const req = makeLoginRequest({
      email: "hanako@example.com",
      password: PASSWORD,
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.token).toBeTruthy();
    expect(body.data.user.role).toBe("manager");
    expect(body.data.user.user_id).toBe(5);
  });

  // AUTH-003: パスワード不正
  it("AUTH-003: 正しいメールアドレスだが誤ったパスワードの場合は401 INVALID_CREDENTIALSを返す", async () => {
    mockFindUnique.mockResolvedValue({
      userId: 1,
      name: "山田 太郎",
      email: "yamada@example.com",
      role: "sales",
      passwordHash: hashedPassword,
      deletedAt: null,
    });

    const req = makeLoginRequest({
      email: "yamada@example.com",
      password: "wrongpassword",
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
    expect(body.error.message).toBe(
      "メールアドレスまたはパスワードが正しくありません。"
    );
  });

  // AUTH-004: メールアドレス不正（存在しないユーザー）
  it("AUTH-004: 存在しないメールアドレスの場合は401 INVALID_CREDENTIALSを返す", async () => {
    mockFindUnique.mockResolvedValue(null);

    const req = makeLoginRequest({
      email: "nonexistent@example.com",
      password: PASSWORD,
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });

  // AUTH-005: 必須項目未入力（email）
  it("AUTH-005: emailが空の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makeLoginRequest({
      email: "",
      password: PASSWORD,
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    // emailに関するdetailsが含まれること
    const emailDetail = body.error.details?.find(
      (d: { field: string }) => d.field === "email"
    );
    expect(emailDetail).toBeDefined();
  });

  // AUTH-006: 必須項目未入力（password）
  it("AUTH-006: passwordが空の場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makeLoginRequest({
      email: "yamada@example.com",
      password: "",
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const passwordDetail = body.error.details?.find(
      (d: { field: string }) => d.field === "password"
    );
    expect(passwordDetail).toBeDefined();
  });

  // 追加: 論理削除済みユーザーのログイン不可
  it("論理削除済みユーザー（deleted_at != null）はログインできず401を返す", async () => {
    mockFindUnique.mockResolvedValue({
      userId: 2,
      name: "退職者",
      email: "deleted@example.com",
      role: "sales",
      passwordHash: hashedPassword,
      deletedAt: new Date("2025-01-01T00:00:00Z"),
    });

    const req = makeLoginRequest({
      email: "deleted@example.com",
      password: PASSWORD,
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });

  // 追加: emailフォーマット不正
  it("emailがメールアドレス形式でない場合は400 VALIDATION_ERRORを返す", async () => {
    const req = makeLoginRequest({
      email: "not-an-email",
      password: PASSWORD,
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const emailDetail = body.error.details?.find(
      (d: { field: string }) => d.field === "email"
    );
    expect(emailDetail).toBeDefined();
  });

  // 追加: リクエストボディが不正なJSON
  it("リクエストボディが不正なJSONの場合は400 VALIDATION_ERRORを返す", async () => {
    const req = new NextRequest("http://localhost/api/v1/auth/login", {
      method: "POST",
      body: "invalid json{",
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // 追加: JWTペイロードにuser_id, email, roleが正しく含まれる
  it("発行されたJWTトークンにuser_id・email・roleが含まれる", async () => {
    mockFindUnique.mockResolvedValue({
      userId: 3,
      name: "佐藤 次郎",
      email: "sato@example.com",
      role: "sales",
      passwordHash: hashedPassword,
      deletedAt: null,
    });

    const req = makeLoginRequest({
      email: "sato@example.com",
      password: PASSWORD,
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);

    // JWTを手動デコード（署名検証なし）してペイロードを確認
    const token: string = body.data.token;
    const parts = token.split(".");
    expect(parts).toHaveLength(3);

    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    expect(payload.user_id).toBe(3);
    expect(payload.email).toBe("sato@example.com");
    expect(payload.role).toBe("sales");
  });
});
