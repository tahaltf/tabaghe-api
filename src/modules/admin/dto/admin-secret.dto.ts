import { IsString, MinLength } from 'class-validator';

export class SetAdminSecretDto {
  @IsString()
  @MinLength(1)
  value!: string;
}
