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
      // 已注册但 verifyCode 已失效 — 重新发一个（不消耗，不动 passwordHash）
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      await p.user.update({
        where: { id: existing.id },
        data: { verifyCode: code, verifyExpiry: new Date(Date.now() + 600_000) },
      });
      console.log('VERIFICATION_CODE=' + code);
    }
    await p.$disconnect();
    return;
  }
  // 新建 pending user + 设置 verifyCode
  // pending user 必须 passwordHash='' 占位（让 register 流程还能看到 EMAIL_TAKEN=false）
  // 真正 hash 由 register 路由调 consumeVerifyCode OK 后写入
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await p.user.upsert({
    where: { email },
    // update 不重设 passwordHash：避免污染已注册用户导致注册接口误判 EMAIL_TAKEN
    // 只刷 verifyCode；create 时才设 占位空 hash（不是真 hash！）
    update: { verifyCode: code, verifyExpiry: new Date(Date.now() + 600_000) },
    create: {
      email,
      passwordHash: '',
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
