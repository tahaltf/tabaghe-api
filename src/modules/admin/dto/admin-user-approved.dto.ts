import { IsBoolean } from 'class-validator';

export class AdminSetUserApprovedDto {
  @IsBoolean({ message: 'مقدار مورد تایید باید true/false باشد' })
  isApproved!: boolean;
}
