import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ArrayNotEmpty,
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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  type?: number;
}

export class UpdateSmsIrTemplateDto extends CreateSmsIrTemplateDto {}

export class AdminSmsIrPageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNumber?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 100;
}

export class AdminSmsIrArchiveQueryDto extends AdminSmsIrPageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fromDate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  toDate?: number;
}

export class AdminSmsIrReceiveLiveQueryDto extends AdminSmsIrPageQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  sortByNewest?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  mobile?: string;
}

export class AdminSmsIrReceiveArchiveQueryDto extends AdminSmsIrArchiveQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  sortByNewest?: boolean;
}

export class AdminSmsIrLatestReceiveQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  count?: number = 100;
}

export class AdminSmsIrSendBulkDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lineNumber?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(900)
  messageText!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  mobiles!: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sendDateTime?: number | null;
}

export class AdminSmsIrSendLikeToLikeDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lineNumber?: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  messageTexts!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  mobiles!: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sendDateTime?: number | null;
}

export class AdminSmsIrVerifyParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(25)
  value!: string;
}

export class AdminSmsIrSendVerifyDto {
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  mobile!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  templateId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdminSmsIrVerifyParamDto)
  parameters!: AdminSmsIrVerifyParamDto[];
}

export class AdminSmsIrSendSimpleDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lineNumber?: number;

  @IsString()
  @MinLength(8)
  @MaxLength(20)
  mobile!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(900)
  text!: string;
}
