import { AsyncLocalStorage } from 'async_hooks';

export interface TraceCtx {
  traceId: string;
  startedAt: number;
}

/**
 * Request-scoped trace ID storage. NestJS handlers, services, and listeners
 * running inside the request's microtask chain can read the active traceId
 * via `traceContext.getStore()?.traceId`.
 */
export const traceContext = new AsyncLocalStorage<TraceCtx>();

export function currentTraceId(): string | undefined {
  return traceContext.getStore()?.traceId;
}
