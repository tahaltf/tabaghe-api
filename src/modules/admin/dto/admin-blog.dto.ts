import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AdminCreateBlogPostDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  image?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  outline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AdminUpdateBlogPostDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  image?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  outline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
