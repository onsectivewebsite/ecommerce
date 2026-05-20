import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { TaxKind } from './tax.types';

const KINDS: TaxKind[] = ['GST', 'HST', 'VAT', 'SALES', 'CONSUMPTION', 'NONE'];
const JTYPES = ['COUNTRY', 'REGION', 'POSTAL_PREFIX'] as const;

export class UpsertTaxRuleDto {
  @IsString() @Length(1, 120)
  name!: string;

  @IsIn(KINDS)
  kind!: TaxKind;

  @IsIn(JTYPES as unknown as string[])
  jurisdictionType!: 'COUNTRY' | 'REGION' | 'POSTAL_PREFIX';

  @IsString() @Length(1, 10)
  jurisdictionCode!: string;

  @IsInt() @Min(0) @Max(1_000_000_000) // 0 → 1000%
  ratePctMicro!: number;

  @IsOptional() @IsBoolean()
  includedInPrice?: boolean;

  @IsOptional() @IsString()
  categorySlug?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(10_000)
  priority?: number;

  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsString()
  notes?: string | null;
}
