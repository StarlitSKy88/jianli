const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const email = process.argv[2];
const password = process.argv[3];
async function main() {
  const p = new PrismaClient();
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  // bcrypt 太慢，先看 schema
  const existing = await p.user.findUnique({ where: { email } });
  if (existing) {
    console.log('EXISTS=' + existing.id);
    await p.$disconnect();
    return;
  }
  // 不预创建用户，直接给 verify-code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await p.user.upsert({
    where: { email },
    update: { verifyCode: code, verifyExpiry: new Date(Date.now() + 600_000) },
    create: {
      email,
      verifyCode: code,
      verifyExpiry: new Date(Date.now() + 600_000),
    },
  });
  console.log('CODE=' + code);
  await p.$disconnect();
}
main().catch((e) => {
  console.log('ERR=' + e.message);
  process.exit(1);
});
