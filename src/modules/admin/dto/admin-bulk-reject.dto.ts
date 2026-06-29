import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MinLength } from 'class-validator';
import { AdminBulkIdsDto } from './admin-bulk-ids.dto';

export class AdminBulkRejectDto extends AdminBulkIdsDto {
  @IsString()
  @MinLength(1)
  rejectionReason!: string;
}
