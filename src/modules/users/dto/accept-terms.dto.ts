import { IsIn, IsOptional } from 'class-validator';

export class AcceptTermsDto {
  @IsOptional()
  @IsIn(['TERMS', 'SELLER'])
  kind?: 'TERMS' | 'SELLER';
}
