export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  code?: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.statusCode = body.statusCode;
    this.code = body.code;
    this.details = body.details;
  }
}
