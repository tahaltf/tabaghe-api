import { IsString, IsInt, Min, Max, IsOptional, IsNotEmpty } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  @IsNotEmpty({ message: 'شناسه سفارش الزامی است' })
  orderId: string;

  @IsInt({ message: 'امتیاز باید یک عدد باشد' })
  @Min(1, { message: 'حداقل امتیاز ۱ است' })
  @Max(5, { message: 'حداکثر امتیاز ۵ است' })
  rating: number;

  @IsString()
  @IsOptional()
  comment?: string;
}