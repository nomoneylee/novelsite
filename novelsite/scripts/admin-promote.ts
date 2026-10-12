import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    console.error('❌ 請提供要提權的使用者 Email：npm run admin:promote <email>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    console.error(`❌ 找不到此 Email 的使用者：${email}`);
    process.exit(1);
  }

  if (user.role === 'admin') {
    console.log(`ℹ️ 使用者 ${user.name} (${email}) 已經具備管理員 (admin) 權限。`);
    process.exit(0);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { role: 'admin' },
    });

    // 撤銷全部 Session，迫使重新登入以反映新角色
    await tx.session.deleteMany({
      where: { userId: user.id },
    });

    // 寫入稽核紀錄
    await tx.auditLog.create({
      data: {
        actorId: 'system-cli',
        action: 'user.promote_cli',
        targetType: 'User',
        targetId: user.id,
        diff: JSON.stringify({ role: { before: user.role, after: 'admin' } }),
        reason: '透過維運終端 CLI 提權',
        ip: '127.0.0.1',
      },
    });
  });

  console.log(`✅ 已成功將使用者 ${user.name} (${email}) 提權為管理員 (admin)。`);
}

main()
  .catch((err) => {
    console.error('❌ 提權執行失敗：', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
