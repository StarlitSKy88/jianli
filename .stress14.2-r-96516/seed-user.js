const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const email = process.argv[2];
const password = process.argv[3];
async function trySeed(attempt) {
  const p = new PrismaClient();
  try {
    const existing = await p.user.findUnique({ where: { email } });
    if (existing && existing.passwordHash) {
      console.log('EXISTS=' + existing.id);
      await p.$disconnect();
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await p.user.upsert({
      where: { email },
      update: {
        passwordHash,
        verifyCode: code,
        verifyExpiry: new Date(Date.now() + 600_000),
      },
      create: {
        email,
        passwordHash,
        verifyCode: code,
        verifyExpiry: new Date(Date.now() + 600_000),
      },
    });
    console.log('CODE=' + code);
    await p.$disconnect();
  } catch (e) {
    console.log('ERR_' + attempt + '=' + (e.message || '').split('\n')[0]);
    await p.$disconnect();
    if (attempt < 4 && /Can't reach database|ECONN|ETIMEDOUT|timeout/i.test(e.message)) {
      await new Promise((r) => setTimeout(r, 2000));
      return trySeed(attempt + 1);
    }
    process.exit(1);
  }
}
trySeed(1);
