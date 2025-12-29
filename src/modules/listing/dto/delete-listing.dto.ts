import { IsString } from 'class-validator';

export class DeleteListingDto {
    @IsString()
    deleteReason!: string;
}
