/**
 * Vitest グローバルセットアップ（全 Worker 共通・プロセスで1回だけ実行）
 *
 * DB の初期化とシードデータ投入をここで行う。
 * setupFiles と異なり Worker ごとに繰り返し実行されないため、
 * 並列テスト時のデータ競合・FK制約エラーを防ぐ。
 */
import { config } from "dotenv";
import path from "path";

// globalSetup は Vitest の Worker 外で動くため、ここで .env.test を読み込む
config({ path: path.resolve(process.cwd(), ".env.test"), override: true });

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

function createSetupClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL が設定されていません。.env.test を確認してください。");
  }
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

async function seedTestData(prisma: PrismaClient): Promise<void> {
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

export async function setup(): Promise<void> {
  const prisma = createSetupClient();
  try {
    await seedTestData(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
