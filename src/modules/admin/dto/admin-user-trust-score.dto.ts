import { IsInt, Max, Min } from 'class-validator';

export class AdminSetUserTrustScoreDto {
  @IsInt({ message: 'امتیاز اعتماد باید عدد صحیح باشد' })
  @Min(0, { message: 'حداقل امتیاز اعتماد ۰ است' })
  @Max(100, { message: 'حداکثر امتیاز اعتماد ۱۰۰ است' })
  trustScore: number;
}
