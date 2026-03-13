/**
 * Vitest グローバルセットアップ
 *
 * テスト実行前に .env.test を読み込み、テスト用DBを初期化する。
 * シードデータを投入して各テストが一定の初期状態から始められるようにする。
 */
import { config } from "dotenv";
import path from "path";

// .env.test を最優先で読み込む（既存の環境変数を上書きする）
config({ path: path.resolve(process.cwd(), ".env.test"), override: true });

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

function createTestClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL が設定されていません。.env.test を確認してください。");
  }
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const prisma = createTestClient();

/**
 * テスト用シードデータ。
 * Issue#4 で定義されたテストユーザー3名を作成する。
 *
 * ユーザー:
 *   yamada@example.com  - sales  (上長: hanako)
 *   sato@example.com    - sales  (上長: hanako)
 *   hanako@example.com  - manager
 */
async function seedTestData(): Promise<void> {
  const passwordHash = await bcrypt.hash("password", 10);

  // 依存関係順に全テーブルをクリア（FK制約を考慮した順序）
  await prisma.comment.deleteMany();
  await prisma.visitAttendee.deleteMany();
  await prisma.visitRecord.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.problem.deleteMany();
  await prisma.dailyReport.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();

  // manager を先に作成（sales が manager_id を参照するため）
  const manager = await prisma.user.create({
    data: {
      name: "上長花子",
      email: "hanako@example.com",
      passwordHash,
      role: "manager",
    },
  });

  await prisma.user.create({
    data: {
      name: "山田太郎",
      email: "yamada@example.com",
      passwordHash,
      role: "sales",
      managerId: manager.userId,
    },
  });

  await prisma.user.create({
    data: {
      name: "佐藤次郎",
      email: "sato@example.com",
      passwordHash,
      role: "sales",
      managerId: manager.userId,
    },
  });
}

// Vitest のグローバルフック
beforeAll(async () => {
  await seedTestData();
});

afterAll(async () => {
  await prisma.$disconnect();
});
