import { IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
    @IsString()
    @Matches(/^\+?\d{10,15}$/)
    phone!: string;

    @IsString()
    @MinLength(6)
    password!: string;
}
