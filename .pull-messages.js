const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const msgs = await p.message.findMany({
    where: { interviewId: 'cmrlu2zp2004q3yt19a28bv7t' },
    orderBy: { createdAt: 'asc' },
  });
  console.log(
    JSON.stringify(
      msgs.map((m) => ({ role: m.role === 'USER' ? 'user' : 'assistant', content: m.content })),
      null,
      2
    )
  );
  await p.$disconnect();
})();
