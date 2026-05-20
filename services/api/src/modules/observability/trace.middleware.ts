import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { newId } from '../../common/id';
import { traceContext } from './trace-context';

const TRACE_HEADER = 'x-trace-id';

/**
 * Mints (or accepts upstream) a trace id per request and propagates it via
 * AsyncLocalStorage so every log line + downstream service call carries it.
 * Also echoes the id on the response so log → request correlation is one
 * grep away.
 */
@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const upstream = req.headers[TRACE_HEADER];
    const traceId = (Array.isArray(upstream) ? upstream[0] : upstream) || newId();
    res.setHeader(TRACE_HEADER, traceId);
    traceContext.run({ traceId, startedAt: Date.now() }, () => next());
  }
}
