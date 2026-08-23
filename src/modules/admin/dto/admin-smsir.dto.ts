import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class AdminSmsIrTemplatesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  /** When true, returns all templates across pages (for dropdown picker). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @Type(() => Boolean)
  all?: boolean;
}

export class CreateSmsIrTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  @Matches(/#\w+#/, {
    message: 'متن قالب باید حداقل یک متغیر با فرمت #name# داشته باشد',
  })
  templateText!: string;
}
