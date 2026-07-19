const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
const email = process.argv[2];
const password = process.argv[3];
(async () => {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const hash = await bcrypt.hash(password, 10);
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
  console.log('VC=' + code);
  await p.$disconnect();
})();
