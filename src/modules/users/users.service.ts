import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { User } from '@prisma/client';

@Injectable()
export class UsersService {
    constructor(private readonly prisma: PrismaService) {}

    findById(id: string): Promise<User | null> {
        return this.prisma.user.findUnique({ where: { id } });
    }

    findByPhone(phone: string): Promise<User | null> {
        return this.prisma.user.findUnique({ where: { phone } });
    }

    async createUser(input: { phone: string; passwordHash: string }) {
        return this.prisma.user.create({
            data: {
                phone: input.phone,
                passwordHash: input.passwordHash,
            },
        });
    }
}
