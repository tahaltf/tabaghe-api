import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type SettingsClient = PrismaService | Prisma.TransactionClient;

export async function readPositiveNumberSetting(
  client: SettingsClient,
  key: string,
  fallback: number,
): Promise<number> {
  const row = await client.systemSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  const parsed = Number(row?.value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export async function readPositiveIntSetting(
  client: SettingsClient,
  key: string,
  fallback: number,
): Promise<number> {
  return Math.floor(await readPositiveNumberSetting(client, key, fallback));
}
