import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Max,
  IsISO8601,
  IsIn,
  Length,
  ArrayMaxSize,
} from 'class-validator';
import type {
  AgeConsentMethod,
  ComplianceRequirementKind,
} from '@onsective/shared-types';

const REQ_KINDS: ComplianceRequirementKind[] = [
  'AGE_GATE',
  'ID_VERIFICATION',
  'LICENSE_DOC',
  'JURISDICTION_RESTRICTED',
  'DIGITAL_LICENSE',
];

const AGE_METHODS: AgeConsentMethod[] = ['SELF_DECLARATION', 'ID_VERIFIED', 'PAYMENT_GATEWAY'];

export class UpsertCategoryComplianceDto {
  @IsOptional() @IsInt() @Min(0) @Max(120)
  minBuyerAge?: number | null;

  @IsOptional() @IsBoolean()
  requiresSellerDoc?: boolean;

  @IsOptional() @IsArray() @ArrayMaxSize(10)
  requirementKinds?: ComplianceRequirementKind[];

  @IsOptional() @IsArray() @ArrayMaxSize(250)
  blockedCountries?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(250)
  allowedCountries?: string[];

  @IsOptional() @IsString() @Length(0, 2000)
  notes?: string | null;
}

export class UploadComplianceDocDto {
  @IsOptional() @IsString()
  categoryId?: string;

  @IsString() @Length(2, 64)
  docType!: string;

  // base64 of file (~10MB limit handled by express json body limit set to 5mb;
  // we expect typical compliance docs <2MB).
  @IsString()
  fileBase64!: string;

  @IsString() @Length(1, 200)
  fileName!: string;
}

export class ReviewComplianceDocDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional() @IsString() @Length(0, 1000)
  rejectionReason?: string;

  @IsOptional() @IsISO8601()
  expiresAt?: string | null;
}

export class AgeConsentDto {
  @IsOptional() @IsString()
  productId?: string;

  @IsOptional() @IsString()
  categoryId?: string;

  @IsISO8601()
  dob!: string;

  @IsOptional() @IsIn(AGE_METHODS)
  method?: AgeConsentMethod;

  @IsOptional() @IsString() @Length(1, 80)
  sessionId?: string;
}

export function isValidRequirementKind(v: unknown): v is ComplianceRequirementKind {
  return typeof v === 'string' && (REQ_KINDS as string[]).includes(v);
}
