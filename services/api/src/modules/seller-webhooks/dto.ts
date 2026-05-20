import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUrl, Length } from 'class-validator';
import { WebhookEventKind } from '@prisma/client';

export class CreateEndpointDto {
  @IsString() @Length(1, 80) name!: string;
  @IsUrl({ require_protocol: true, protocols: ['https'] }) url!: string;
  @IsArray() @ArrayMinSize(1) @IsEnum(WebhookEventKind, { each: true })
  events!: WebhookEventKind[];
}

export class UpdateEndpointDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsUrl({ require_protocol: true, protocols: ['https'] }) url?: string;
  @IsOptional() @IsArray() @IsEnum(WebhookEventKind, { each: true })
  events?: WebhookEventKind[];
  @IsOptional() active?: boolean;
}
