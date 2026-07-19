const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const email = process.argv[2];
const password = process.argv[3];
async function main() {
  const p = new PrismaClient();
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
}
main().catch((e) => {
  console.log('ERR=' + e.message);
  process.exit(1);
});
