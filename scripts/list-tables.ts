import { prisma } from '../lib/db/client';

async function main() {
  const tables =
    await prisma.$queryRawUnsafe<Array<{ Tables_in_interview_buddy: string }>>('SHOW TABLES');
  console.log('Tables in interview_buddy:');
  for (const t of tables) console.log('  ' + Object.values(t)[0]);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
