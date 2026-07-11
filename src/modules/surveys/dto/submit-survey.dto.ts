import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SubmitSurveyDto {
  @Type(() => Number)
  @IsInt({ message: 'امتیاز باید عدد صحیح باشد' })
  @Min(1, { message: 'حداقل امتیاز ۱ است' })
  @Max(10, { message: 'حداکثر امتیاز ۱۰ است' })
  score: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'توضیح حداکثر ۲۰۰۰ کاراکتر است' })
  comment?: string;
}
