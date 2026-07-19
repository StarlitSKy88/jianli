const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const email = process.argv[2];
const password = process.argv[3];
const p = new PrismaClient();
(async () => {
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
