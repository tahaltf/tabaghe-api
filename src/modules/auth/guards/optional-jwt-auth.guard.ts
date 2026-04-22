import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../../../shared/contracts/auth';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<T = AuthenticatedUser>(
    _err: unknown,
    user: T | false,
  ): T | null {
    return user ? (user as T) : null;
  }
}
