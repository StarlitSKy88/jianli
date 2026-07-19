const { PrismaClient } = require('@prisma/client');
const email = process.argv[2];
async function charge(attempt) {
  const p = new PrismaClient();
  try {
    const u = await p.user.update({ where: { email }, data: { paidQuota: 100, freeQuotaUsed: 0 } });
    console.log('OK=' + u.paidQuota);
    await p.$disconnect();
  } catch (e) {
    console.log('ERR_' + attempt + '=' + (e.message || '').split('\n')[0]);
    await p.$disconnect();
    if (attempt < 4 && /Can't reach database|ECONN|ETIMEDOUT|timeout/i.test(e.message)) {
      await new Promise((r) => setTimeout(r, 2000));
      return charge(attempt + 1);
    }
    process.exit(1);
  }
}
charge(1);
