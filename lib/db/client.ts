/**
 * Prisma Client 单例（避免 dev hot reload 时多次实例化）
 */
import { PrismaClient } from '@prisma/client';
import { getEnv } from '@/lib/env';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const isDev = getEnv('NODE_ENV') === 'development';

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isDev ? ['query', 'warn', 'error'] : ['error'],
  });

if (isDev) {
  globalForPrisma.prisma = prisma;
}
