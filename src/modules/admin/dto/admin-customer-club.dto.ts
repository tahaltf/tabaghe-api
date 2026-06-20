import { IsOptional, IsString } from 'class-validator';

export class AdminAddCustomerClubDto {
  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;
}

export class AdminImportCustomerClubDto {
  @IsOptional()
  @IsString()
  text?: string;
}
