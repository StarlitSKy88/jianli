const { PrismaClient } = require('@prisma/client');
async function check(attempt) {
  const p = new PrismaClient();
  try {
    const u = await p.user.findUnique({ where: { email: 'd30-1784104985-2220@taomyst.top' } });
    if (u) console.log('paidQuota=' + u.paidQuota + ' freeQuotaUsed=' + u.freeQuotaUsed);
    const iv = await p.interview.findUnique({ where: { id: 'cmrlu2zp2004q3yt19a28bv7t' } });
    if (iv)
      console.log(
        'interview.status=' +
          iv.status +
          ' totalScore=' +
          iv.totalScore +
          ' isFreeQuota=' +
          iv.isFreeQuota
      );
    const msgCount = await p.message.count({ where: { interviewId: 'cmrlu2zp2004q3yt19a28bv7t' } });
    console.log('messages=' + msgCount);
    const report = await p.report.findFirst({
      where: { interviewId: 'cmrlu2zp2004q3yt19a28bv7t' },
    });
    console.log(
      'report=' + (report ? 'EXISTS id=' + report.id + ' total=' + report.totalScore : 'NULL')
    );
    await p.$disconnect();
  } catch (e) {
    await p.$disconnect();
    const msg = (e.message || '').split('\n')[0];
    console.log('ERR_' + attempt + '=' + msg);
    if (attempt < 4 && /Can't reach|ECONN|ETIMEDOUT|timeout|empty/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 3000));
      return check(attempt + 1);
    }
  }
}
check(1);
