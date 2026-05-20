export interface BulkRowReportDto {
  row: number;
  status: 'ok' | 'error';
  message?: string;
  productId?: string;
  slug?: string;
  title?: string;
}

export interface BulkImportReportDto {
  dryRun: boolean;
  total: number;
  okCount: number;
  errorCount: number;
  rows: BulkRowReportDto[];
}
