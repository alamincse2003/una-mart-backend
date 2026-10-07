import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const OTP_PATTERN = /^\d{6}$/;

export class OtpRequestDto {
  @ApiProperty({ example: '01712345678' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ enum: ['login', 'checkout'], description: 'checkout = verify the phone for a COD order' })
  @IsIn(['login', 'checkout'])
  purpose!: 'login' | 'checkout';
}

export class OtpVerifyDto {
  @ApiProperty({ example: '01712345678' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ example: '123456' })
  @Matches(OTP_PATTERN, { message: 'code must be 6 digits' })
  code!: string;
}

export class AdminLoginDto {
  @ApiProperty({ example: '01712345678' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  password!: string;
}

export class UpdateMeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(120) email?: string;
}

export class OtpSentDto {
  @ApiProperty() expiresInSeconds!: number;
  @ApiPropertyOptional({ description: 'Development only (SMS_PROVIDER=console)' }) devCode?: string;
}

export class MeDto {
  @ApiProperty() id!: string;
  @ApiProperty() phone!: string;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ enum: ['customer', 'admin', 'seller'] }) role!: string;
  @ApiProperty({ enum: ['customer', 'admin'], description: 'admin = logged in through admin login' })
  scope!: string;
}
