import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class OnboardProfileDto {
  @IsNotEmpty()
  @IsString()
  @Length(3, 20)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message:
      'Username can only contain alphanumeric characters and underscores',
  })
  username: string;

  @IsNotEmpty()
  @IsString()
  @Length(2, 50)
  full_name: string;

  @IsNotEmpty()
  @IsString()
  province: string;

  @IsNotEmpty()
  @IsString()
  city_or_district: string;
}
