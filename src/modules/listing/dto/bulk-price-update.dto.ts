import { IsString, MaxLength, MinLength } from 'class-validator';

export class BulkPriceUpdateDto {
  @IsString()
  @MinLength(1, { message: 'متن قیمت‌ها الزامی است' })
  @MaxLength(100_000, { message: 'متن بیش از حد طولانی است' })
  text!: string;
}
