import { IsBoolean } from 'class-validator';

export class AdminSetUserActivationDto {
  @IsBoolean({ message: 'مقدار فعال بودن باید true/false باشد' })
  isActive!: boolean;
}
