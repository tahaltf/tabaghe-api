import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, Min } from 'class-validator';
import { ItemCondition, ListingType } from '@prisma/client';
import { PaginationQueryDto } from '../../../shared/contracts/pagination';

export type ListingSort = 'newest' | 'oldest' | 'price_asc' | 'price_desc';

const LISTING_SORTS: ListingSort[] = [
  'newest',
  'oldest',
  'price_asc',
  'price_desc',
];

export class ListListingsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  provinceId?: string;

  @IsOptional()
  @IsString()
  cityId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsEnum(ListingType)
  type?: ListingType;

  @IsOptional()
  @IsEnum(ItemCondition)
  condition?: ItemCondition;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(LISTING_SORTS, { message: 'نوع مرتب‌سازی نامعتبر است' })
  sort?: ListingSort;

  /** slug دسته‌ای که باید از نتایج حذف شود (خود + زیرشاخه‌ها) */
  @IsOptional()
  @IsString()
  excludeCategorySlug?: string;
}
