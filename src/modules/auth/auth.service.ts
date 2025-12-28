import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';

type JwtPayload = { sub: string; role: string };

@Injectable()
export class AuthService {
    private readonly accessTtl: number;
    private readonly refreshTtl: number;
    private readonly accessSecret: string;
    private readonly refreshSecret: string;

    constructor(
        private readonly users: UsersService,
        private readonly wallet: WalletService,
        private readonly jwt: JwtService,
        private readonly config: ConfigService,
    ) {
        this.accessSecret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
        this.refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
        this.accessTtl = Number(this.config.get('JWT_ACCESS_TTL_SECONDS') ?? 900);
        this.refreshTtl = Number(this.config.get('JWT_REFRESH_TTL_SECONDS') ?? 604800);
    }

    async register(phone: string, password: string) {
        const existing = await this.users.findByPhone(phone);
        if (existing) throw new BadRequestException('Phone already registered');

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await this.users.createUser({ phone, passwordHash });

        // create wallet for user (idempotency handled by unique constraint in schema)
        await this.wallet.createWalletForUser(user.id).catch(() => null);

        return this.issueTokens(user.id, user.role);
    }

    async login(phone: string, password: string) {
        const user = await this.users.findByPhone(phone);
        if (!user) throw new UnauthorizedException('Invalid credentials');

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) throw new UnauthorizedException('Invalid credentials');

        return this.issueTokens(user.id, user.role);
    }

    async refresh(refreshToken: string) {
        let payload: JwtPayload;
        try {
            payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
                secret: this.refreshSecret,
            });
        } catch {
            throw new UnauthorizedException('Invalid refresh token');
        }

        return this.issueTokens(payload.sub, payload.role);
    }

    private async issueTokens(userId: string, role: string) {
        const payload: JwtPayload = { sub: userId, role };

        const accessToken = await this.jwt.signAsync(payload, {
            secret: this.accessSecret,
            expiresIn: this.accessTtl,
        });

        const refreshToken = await this.jwt.signAsync(payload, {
            secret: this.refreshSecret,
            expiresIn: this.refreshTtl,
        });

        return {
            accessToken,
            refreshToken,
            tokenType: 'Bearer',
            expiresIn: this.accessTtl,
        };
    }
}
