import { ListingStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class SetListingStatusDto {
  @IsEnum(ListingStatus)
  status!: ListingStatus;
}
