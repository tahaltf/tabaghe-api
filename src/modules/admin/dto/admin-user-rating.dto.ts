import { IsNumber, Max, Min } from 'class-validator';

export class AdminSetUserRatingDto {
  @IsNumber({}, { message: 'امتیاز باید عددی باشد' })
  @Min(0, { message: 'حداقل امتیاز ۰ است' })
  @Max(5, { message: 'حداکثر امتیاز ۵ است' })
  rating: number;
}
