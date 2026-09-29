import { IsString, MinLength } from 'class-validator';

export class CreateMergeRequestDto {
  @IsString()
  @MinLength(1)
  targetListingId!: string;
}
