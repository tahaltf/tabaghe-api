import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import {
  CreateListingDto,
  GalleryOrderSlotDto,
  transformGalleryOrder,
} from './create-listing.dto';

/**
 * تمام فیلدهای CreateListingDto در حالت update اختیاری هستند.
 * galleryOrder صریحاً تکرار شده چون PartialType متادیتای ValidateNested/@Type آرایه را حفظ نمی‌کند.
 */
export class UpdateListingDto extends PartialType(CreateListingDto) {
  @IsOptional()
  @Transform(transformGalleryOrder)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GalleryOrderSlotDto)
  declare galleryOrder?: GalleryOrderSlotDto[];
}
