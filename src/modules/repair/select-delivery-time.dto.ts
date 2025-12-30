import { IsDateString } from 'class-validator';

export class SelectDeliveryTimeDto {
    @IsDateString()
    selectedDeliveryTime: string;
}
