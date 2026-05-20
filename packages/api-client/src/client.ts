import { ApiError, type ApiErrorBody } from '@onsective/shared-types';

export interface ClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null | undefined;
  onUnauthorized?: () => Promise<string | null> | string | null;
  defaultHeaders?: Record<string, string>;
  credentials?: RequestCredentials;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  noAuth?: boolean;
}

function buildUrl(base: string, path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export class OnsectiveClient {
  constructor(private readonly opts: ClientOptions) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.doRequest<T>(path, options, false);
  }

  private async doRequest<T>(
    path: string,
    options: RequestOptions,
    isRetry: boolean,
  ): Promise<T> {
    const fetchFn = this.opts.fetchImpl ?? fetch;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(this.opts.defaultHeaders ?? {}),
      ...(options.headers ?? {}),
    };
    if (options.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (!options.noAuth) {
      const token = this.opts.getAccessToken?.();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const url = buildUrl(this.opts.baseUrl, path, options.query);
    const response = await fetchFn(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: this.opts.credentials ?? 'include',
    });

    if (response.status === 401 && !isRetry && this.opts.onUnauthorized && !options.noAuth) {
      const refreshed = await this.opts.onUnauthorized();
      if (refreshed) {
        return this.doRequest<T>(path, options, true);
      }
    }

    if (!response.ok) {
      let body: ApiErrorBody;
      try {
        body = (await response.json()) as ApiErrorBody;
      } catch {
        body = {
          statusCode: response.status,
          error: response.statusText,
          message: response.statusText || 'Request failed',
        };
      }
      throw new ApiError(body);
    }

    if (response.status === 204) return undefined as T;
    const ct = response.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }
}
