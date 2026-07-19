const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
// process.argv = [node, script, email, password]
const email = process.argv[2];
const password = process.argv[3];
const p = new PrismaClient();
(async () => {
  const existing = await p.user.findUnique({ where: { email } });
  // 如果已注册且有密码，复用最近一次验证码（如果还存在）
  if (existing && existing.passwordHash && existing.passwordHash.length > 0) {
    if (
      existing.verifyCode &&
      existing.verifyExpiry &&
      existing.verifyExpiry.getTime() > Date.now()
    ) {
      console.log('VERIFICATION_CODE=' + existing.verifyCode);
    } else {
      // 已注册但 verifyCode 已失效 — 重新发一个（不消耗）
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const hash = await bcrypt.hash(password, 10);
      await p.user.update({
        where: { id: existing.id },
        data: {
          verifyCode: code,
          verifyExpiry: new Date(Date.now() + 600_000),
          passwordHash: hash,
        },
      });
      console.log('VERIFICATION_CODE=' + code);
    }
    await p.$disconnect();
    return;
  }
  // 新建 pending user + 设置 verifyCode
  const hash = await bcrypt.hash(password, 10);
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await p.user.upsert({
    where: { email },
    update: { verifyCode: code, verifyExpiry: new Date(Date.now() + 600_000), passwordHash: hash },
    create: {
      email,
      passwordHash: hash,
      verifyCode: code,
      verifyExpiry: new Date(Date.now() + 600_000),
      emailVerified: false,
    },
  });
  console.log('VERIFICATION_CODE=' + code);
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR=' + e.message);
  process.exit(1);
});
