import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @MaxLength(8000)
  body!: string;

  /** MinIO object keys previously obtained from /messaging/attachments/presign. */
  @IsArray()
  @IsOptional()
  attachmentKeys?: string[];
}

export class PresignAttachmentDto {
  @IsString()
  @MaxLength(200)
  filename!: string;

  @IsString()
  @MaxLength(100)
  contentType!: string;
}

export class MuteDto {
  @IsOptional()
  muted?: boolean;
}
