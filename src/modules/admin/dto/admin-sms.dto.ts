import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AdminSmsBroadcastDto {
  @IsInt()
  templateId!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  parameterName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  parameterValue!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];
}
