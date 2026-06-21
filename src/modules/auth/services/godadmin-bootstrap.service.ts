import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { GODADMIN_PHONE } from '../../../shared/test-users';

@Injectable()
export class GodadminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(GodadminBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const bootstrapPassword = process.env.GODADMIN_BOOTSTRAP_PASSWORD?.trim();
    const existing = await this.prisma.user.findUnique({
      where: { phone: GODADMIN_PHONE },
      select: { id: true, passwordHash: true },
    });

    if (!existing) {
      const data: {
        phone: string;
        role: UserRole;
        isActive: boolean;
        passwordHash?: string;
      } = {
        phone: GODADMIN_PHONE,
        role: UserRole.GODADMIN,
        isActive: true,
      };
      if (bootstrapPassword) {
        data.passwordHash = await bcrypt.hash(bootstrapPassword, 10);
      } else if (process.env.NODE_ENV !== 'production') {
        this.logger.warn(
          `GODADMIN created without password; set GODADMIN_BOOTSTRAP_PASSWORD or use dev seed.`,
        );
      }
      await this.prisma.user.create({ data });
      this.logger.log(`Default GODADMIN created for ${GODADMIN_PHONE}.`);
      return;
    }

    const updateData: {
      role?: UserRole;
      isActive?: boolean;
      passwordHash?: string;
    } = {
      role: UserRole.GODADMIN,
      isActive: true,
    };

    if (!existing.passwordHash && bootstrapPassword) {
      updateData.passwordHash = await bcrypt.hash(bootstrapPassword, 10);
    }

    await this.prisma.user.update({
      where: { id: existing.id },
      data: updateData,
    });
  }
}
