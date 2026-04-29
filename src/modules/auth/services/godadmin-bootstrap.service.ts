import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const GODADMIN_PHONE = '09190949469';
const GODADMIN_DEFAULT_PASSWORD = '@Ab123456789@';

@Injectable()
export class GodadminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(GodadminBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { phone: GODADMIN_PHONE },
      select: { id: true, passwordHash: true },
    });

    if (!existing) {
      const passwordHash = await bcrypt.hash(GODADMIN_DEFAULT_PASSWORD, 10);
      await this.prisma.user.create({
        data: {
          phone: GODADMIN_PHONE,
          role: UserRole.GODADMIN,
          isActive: true,
          passwordHash,
        },
      });
      this.logger.log(`Default GODADMIN created for ${GODADMIN_PHONE}.`);
      return;
    }

    const updateData: {
      role?: UserRole;
      isActive?: boolean;
      passwordHash?: string;
    } = {};

    // Ensure this reserved phone always remains GODADMIN and active.
    updateData.role = UserRole.GODADMIN;
    updateData.isActive = true;

    // Do not override password when it already exists.
    if (!existing.passwordHash) {
      updateData.passwordHash = await bcrypt.hash(GODADMIN_DEFAULT_PASSWORD, 10);
    }

    await this.prisma.user.update({
      where: { id: existing.id },
      data: updateData,
    });
  }
}
