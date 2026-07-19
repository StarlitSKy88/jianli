const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const hash = await bcrypt.hash('Test1234!', 10);
  const r = await p.user.upsert({
    where: { email: process.argv[2] },
    update: { verifyCode: code, verifyExpiry: new Date(Date.now() + 600000), passwordHash: hash },
    create: {
      email: process.argv[2],
      passwordHash: hash,
      verifyCode: code,
      verifyExpiry: new Date(Date.now() + 600000),
      emailVerified: false,
    },
  });
  console.log('ID=' + r.id + ' VC=' + code);
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR=' + e.message.split('\n')[0]);
  process.exit(1);
});
