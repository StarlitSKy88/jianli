const { PrismaClient } = require('@prisma/client');
const email = process.argv[2];
async function charge(attempt) {
  const p = new PrismaClient();
  try {
    const u = await p.user.update({ where: { email }, data: { paidQuota: 100, freeQuotaUsed: 0 } });
    console.log('OK=' + u.paidQuota);
    await p.$disconnect();
  } catch (e) {
    await p.$disconnect();
    const msg = (e.message || '').split('\n')[0];
    console.log('ERR_' + attempt + '=' + msg);
    if (attempt < 4 && /Can't reach|ECONN|ETIMEDOUT|timeout/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 2000));
      return charge(attempt + 1);
    }
  }
}
charge(1);
