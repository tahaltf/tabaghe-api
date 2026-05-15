import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class AdminBulkIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}
