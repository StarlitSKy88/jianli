const { PrismaClient } = require('@prisma/client');
const email = process.argv[2];
const p = new PrismaClient();
(async () => {
  await p.user.update({ where: { email }, data: { paidQuota: 100 } });
  console.log('OK');
  await p.$disconnect();
})();
