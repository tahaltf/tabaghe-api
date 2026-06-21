import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

function resolveDatabaseUrl(): string {
  const base = process.env.DATABASE_URL?.trim() ?? '';
  const limit = process.env.PRISMA_CONNECTION_LIMIT?.trim();
  if (!base || !limit) return base;
  try {
    const url = new URL(base);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', limit);
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '10');
    }
    return url.toString();
  } catch {
    return base;
  }
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = resolveDatabaseUrl();
    super({
      datasources: url ? { db: { url } } : undefined,
    });
    if (process.env.PRISMA_CONNECTION_LIMIT?.trim()) {
      this.logger.log(
        `Prisma connection_limit=${process.env.PRISMA_CONNECTION_LIMIT} (use PgBouncer URL in production)`,
      );
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
