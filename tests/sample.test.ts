/**
 * サンプルテスト
 *
 * テスト環境が正しく構築されていることを検証する。
 * - テスト用DBに接続できること
 * - シードユーザーが存在すること
 * - JWT ヘルパーが正しいトークンを生成すること
 */
import { describe, it, expect, afterAll } from "vitest";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import {
  generateTestToken,
  generateSalesToken,
  generateManagerToken,
  type TokenPayload,
} from "./helpers/jwt";

function createTestClient(): PrismaClient {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const prisma = createTestClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("テスト環境のセットアップ確認", () => {
  describe("DB: シードユーザーが存在する", () => {
    it("yamada@example.com (sales) が作成されている", async () => {
      const user = await prisma.user.findUnique({
        where: { email: "yamada@example.com" },
      });
      expect(user).not.toBeNull();
      expect(user?.role).toBe("sales");
      expect(user?.name).toBe("山田太郎");
    });

    it("sato@example.com (sales) が作成されている", async () => {
      const user = await prisma.user.findUnique({
        where: { email: "sato@example.com" },
      });
      expect(user).not.toBeNull();
      expect(user?.role).toBe("sales");
      expect(user?.name).toBe("佐藤次郎");
    });

    it("hanako@example.com (manager) が作成されている", async () => {
      const user = await prisma.user.findUnique({
        where: { email: "hanako@example.com" },
      });
      expect(user).not.toBeNull();
      expect(user?.role).toBe("manager");
      expect(user?.name).toBe("上長花子");
    });

    it("sales ユーザーの managerId が上長花子のIDを参照している", async () => {
      const manager = await prisma.user.findUniqueOrThrow({
        where: { email: "hanako@example.com" },
      });
      const yamada = await prisma.user.findUniqueOrThrow({
        where: { email: "yamada@example.com" },
      });
      expect(yamada.managerId).toBe(manager.userId);
    });

    it("全シードユーザーのパスワードは空ではない", async () => {
      const users = await prisma.user.findMany({
        select: { email: true, passwordHash: true },
      });
      expect(users).toHaveLength(3);
      for (const user of users) {
        expect(user.passwordHash.length).toBeGreaterThan(0);
      }
    });
  });

  describe("JWT ヘルパー: generateTestToken", () => {
    it("正しいペイロードで署名されたJWTを生成する", () => {
      const payload: TokenPayload = { userId: 1, email: "yamada@example.com", role: "sales" };
      const token = generateTestToken(payload);

      const secret = process.env.JWT_SECRET!;
      const decoded = jwt.verify(token, secret) as TokenPayload;

      expect(decoded.userId).toBe(1);
      expect(decoded.email).toBe("yamada@example.com");
      expect(decoded.role).toBe("sales");
    });

    it("JWT_SECRET が未設定のときはエラーをスローする", () => {
      const original = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      expect(() =>
        generateTestToken({ userId: 1, email: "test@example.com", role: "sales" }),
      ).toThrow("JWT_SECRET が設定されていません");

      process.env.JWT_SECRET = original;
    });

    it("生成されたトークンは有効期限 (exp) を持つ", () => {
      const token = generateTestToken({ userId: 1, email: "test@example.com", role: "sales" });
      const decoded = jwt.decode(token) as { exp?: number };
      expect(decoded.exp).toBeDefined();
      expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("異なるロールで生成したトークンは異なる内容になる", () => {
      const salesToken = generateTestToken({ userId: 1, email: "a@example.com", role: "sales" });
      const managerToken = generateTestToken({
        userId: 2,
        email: "b@example.com",
        role: "manager",
      });

      const decodedSales = jwt.decode(salesToken) as TokenPayload;
      const decodedManager = jwt.decode(managerToken) as TokenPayload;

      expect(decodedSales.role).toBe("sales");
      expect(decodedManager.role).toBe("manager");
      expect(salesToken).not.toBe(managerToken);
    });
  });

  describe("JWT ヘルパー: generateSalesToken / generateManagerToken", () => {
    it("generateSalesToken は role=sales のトークンを返す", async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: "yamada@example.com" },
      });
      const token = generateSalesToken(user.userId);
      const decoded = jwt.decode(token) as TokenPayload;

      expect(decoded.role).toBe("sales");
      expect(decoded.userId).toBe(user.userId);
      expect(decoded.email).toBe("yamada@example.com");
    });

    it("generateManagerToken は role=manager のトークンを返す", async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: "hanako@example.com" },
      });
      const token = generateManagerToken(user.userId);
      const decoded = jwt.decode(token) as TokenPayload;

      expect(decoded.role).toBe("manager");
      expect(decoded.userId).toBe(user.userId);
      expect(decoded.email).toBe("hanako@example.com");
    });

    it("generateSalesToken にカスタムemailを渡せる", () => {
      const token = generateSalesToken(99, "custom@example.com");
      const decoded = jwt.decode(token) as TokenPayload;

      expect(decoded.userId).toBe(99);
      expect(decoded.email).toBe("custom@example.com");
      expect(decoded.role).toBe("sales");
    });
  });
});
