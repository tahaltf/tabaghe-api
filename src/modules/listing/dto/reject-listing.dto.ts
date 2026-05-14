import { IsString } from 'class-validator';

export class RejectListingDto {
  @IsString()
  rejectionReason!: string;
}
