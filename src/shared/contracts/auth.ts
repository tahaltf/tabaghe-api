import { UserRole, UserStatus } from './enums';

/**
 * ساختار payload داخل JWT.
 * از sub به‌عنوان استاندارد استفاده می‌کنیم.
 */
export interface JwtPayload {
  sub: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  isVerified: boolean;
}

/**
 * این شیء بعد از JwtStrategy.validate() در `request.user` قرار می‌گیرد.
 * هر controller با @CurrentUser() دقیقاً همین تایپ را دریافت می‌کند.
 */
export interface AuthenticatedUser {
  id: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  isVerified: boolean;
  /** نقش سفارشی پنل ادمین (فقط برای ADMIN) */
  adminRoleId?: string | null;
  /** کلید پرمیشن‌ها؛ برای GODADMIN برابر ['*'] */
  permissions?: string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthPublicUser {
  id: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  isVerified: boolean;
}

export interface AuthSessionResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthPublicUser;
}
