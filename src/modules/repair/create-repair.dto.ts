import { IsArray, IsString } from 'class-validator';

export class CreateRepairDto {
    @IsString()
    deviceType: string; // mobile | laptop | tablet

    @IsString()
    brand: string;

    @IsString()
    model: string;

    @IsString()
    description: string;

    @IsArray()
    images: string[];
}
