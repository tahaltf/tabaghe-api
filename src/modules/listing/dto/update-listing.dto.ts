import { PartialType } from '@nestjs/mapped-types';
import { CreateListingDto } from './create-listing.dto';

/**
 * تمام فیلدهای CreateListingDto در حالت update اختیاری هستند.
 */
export class UpdateListingDto extends PartialType(CreateListingDto) {}
