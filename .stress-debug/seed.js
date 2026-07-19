const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  const hash = await bcrypt.hash(process.argv[2], 10);
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await p.user.upsert({
    where: { email: process.argv[1] },
    update: { passwordHash: hash, verifyCode: code, verifyExpiry: new Date(Date.now() + 600_000) },
    create: {
      email: process.argv[1],
      passwordHash: hash,
      verifyCode: code,
      verifyExpiry: new Date(Date.now() + 600_000),
    },
  });
  console.log(code);
  await p.$disconnect();
})();
