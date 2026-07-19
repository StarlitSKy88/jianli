const { PrismaClient } = require('@prisma/client');
async function go(attempt) {
  const p = new PrismaClient();
  try {
    const u = await p.user.findUnique({ where: { email: 'd30-1784104985-2220@taomyst.top' } });
    if (u) {
      console.log('USER=' + u.id + ' paidQuota=' + u.paidQuota);
      // 充到 200
      const upd = await p.user.update({
        where: { email: 'd30-1784104985-2220@taomyst.top' },
        data: { paidQuota: 200, freeQuotaUsed: 0 },
      });
      console.log('UPDATED paidQuota=' + upd.paidQuota);
    }
    await p.$disconnect();
  } catch (e) {
    await p.$disconnect();
    const msg = (e.message || '').split('\n')[0];
    console.log('ERR_' + attempt + '=' + msg);
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000));
      return go(attempt + 1);
    }
  }
}
go(1);
