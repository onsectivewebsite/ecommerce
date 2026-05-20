import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty() @IsString() variantId!: string;
  @ApiProperty() @IsInt() @Min(1) qty!: number;
}

export class UpdateCartItemDto {
  @ApiProperty() @IsInt() @Min(0) qty!: number;
}
