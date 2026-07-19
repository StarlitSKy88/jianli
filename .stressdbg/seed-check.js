const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  const hash = await bcrypt.hash(process.argv[2], 10);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await p.user.upsert({
    where: { email: process.argv[1] },
    update: {
      passwordHash: hash,
      verifyCode: code,
      verifyExpiry: new Date(Date.now() + 600_000),
      emailVerified: false,
    },
    create: {
      email: process.argv[1],
      passwordHash: '',
      verifyCode: code,
      verifyExpiry: new Date(Date.now() + 600_000),
      emailVerified: false,
    },
  });
  // 双查
  const u1 = await p.user.findUnique({
    where: { email: process.argv[1] },
    select: {
      id: true,
      email: true,
      verifyCode: true,
      verifyExpiry: true,
      emailVerified: true,
      passwordHash: true,
    },
  });
  console.log('AFTER_UPSERT:', JSON.stringify(u1));
  console.log('CODE_VALUE=' + code);
  await p.$disconnect();
})();
