import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// 開発環境でのホットリロード時にPrismaClientが複数生成されないようにシングルトンにする
export const prisma: PrismaClient = globalThis.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
