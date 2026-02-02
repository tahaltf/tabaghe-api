import { IsString, Matches } from 'class-validator';

export class LoginDto {
    @IsString()
    @Matches(/^\+?\d{10,15}$/)
    phone!: string;

    @IsString()
    password!: string;
}
