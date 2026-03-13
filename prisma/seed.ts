import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("シードデータを投入します...");

  // 既存データを削除（順序に注意）
  await prisma.comment.deleteMany();
  await prisma.visitAttendee.deleteMany();
  await prisma.visitRecord.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.problem.deleteMany();
  await prisma.dailyReport.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("password", 10);

  // 上長花子（manager）を先に作成
  const manager = await prisma.user.create({
    data: {
      name: "上長花子",
      email: "hanako.jocho@example.com",
      passwordHash,
      role: "manager",
    },
  });

  // 山田太郎（sales）
  const yamada = await prisma.user.create({
    data: {
      name: "山田太郎",
      email: "taro.yamada@example.com",
      passwordHash,
      role: "sales",
      managerId: manager.userId,
    },
  });

  // 佐藤次郎（sales）
  const sato = await prisma.user.create({
    data: {
      name: "佐藤次郎",
      email: "jiro.sato@example.com",
      passwordHash,
      role: "sales",
      managerId: manager.userId,
    },
  });

  console.log("テストユーザーを作成しました:");
  console.log(`  - ${manager.name} (${manager.role}) [ID: ${manager.userId}]`);
  console.log(`  - ${yamada.name} (${yamada.role}) [ID: ${yamada.userId}]`);
  console.log(`  - ${sato.name} (${sato.role}) [ID: ${sato.userId}]`);

  console.log("\nシードデータの投入が完了しました。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
