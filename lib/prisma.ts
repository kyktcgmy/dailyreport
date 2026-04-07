import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL!;
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// Proxyで遅延初期化：モジュール読み込み時にDB接続しない（ビルド時エラー回避）
let _instance: PrismaClient | undefined;

function getInstance(): PrismaClient {
  if (!_instance) {
    _instance = globalThis.__prisma ?? createPrismaClient();
    if (process.env.NODE_ENV !== "production") {
      globalThis.__prisma = _instance;
    }
  }
  return _instance;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return getInstance()[prop as keyof PrismaClient];
  },
});
