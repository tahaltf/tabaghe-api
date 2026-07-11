import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  ListingImportSource,
  ListingStatus,
  ListingType,
  OrderStatus,
  OrderType,
  RepairRequestStatus,
  TicketStatus,
  UserRole,
  UserStatus,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';

/**
 * DTO مشترک پنل ادمین برای لیست‌ها: صفحه‌بندی + سرچ + سورت.
 */
export class AdminListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortDir?: 'asc' | 'desc';
}

export class AdminUserListQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class AdminListingListQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;

  @IsOptional()
  @IsEnum(ListingType)
  type?: ListingType;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  provinceId?: string;

  @IsOptional()
  @IsEnum(ListingImportSource)
  importSource?: ListingImportSource;
}

export class AdminSetListingStatusDto {
  @IsEnum(ListingStatus)
  status!: ListingStatus;
}

export class AdminSetListingFeaturedDto {
  @IsBoolean()
  isFeatured!: boolean;
}

export class AdminOrderListQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(OrderType)
  type?: OrderType;

  /** CART = از سبد خرید، DIRECT = خرید تکی */
  @IsOptional()
  @IsIn(['CART', 'DIRECT'])
  purchaseSource?: 'CART' | 'DIRECT';
}

export class AdminTransactionListQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsEnum(WalletTransactionType)
  type?: WalletTransactionType;

  @IsOptional()
  @IsEnum(WalletTransactionStatus)
  status?: WalletTransactionStatus;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class AdminRepairListQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsEnum(RepairRequestStatus)
  status?: RepairRequestStatus;
}

export class AdminTicketListQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;
}
