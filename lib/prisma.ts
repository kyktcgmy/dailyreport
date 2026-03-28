/**
 * Prisma クライアントシングルトン
 *
 * Prisma v7 の Query Compiler モードでは Driver Adapter が必須のため、
 * @prisma/adapter-pg + pg Pool 経由で接続する。
 * 開発・テスト・本番環境ともにこのモジュールを経由してDBアクセスする。
 */
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 環境変数が設定されていません。");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// Next.js の Hot Reload でクライアントが複数作られないようにグローバルキャッシュを使う
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
