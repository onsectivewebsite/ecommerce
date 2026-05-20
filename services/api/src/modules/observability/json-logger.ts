import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { currentTraceId } from './trace-context';

/**
 * Replaces Nest's pretty console logger with a structured JSON one when
 * `LOG_FORMAT=json` is set. Each line includes the current request's
 * traceId when present.
 *
 * Kept dependency-free on purpose — pino / winston would force a wider
 * dependency choice; JSON.stringify is enough for parsing by Loki / CloudWatch.
 */
export class JsonLogger extends ConsoleLogger {
  log(message: any, context?: string)   { this.emit('log', message, context); }
  warn(message: any, context?: string)  { this.emit('warn', message, context); }
  error(message: any, trace?: string, context?: string) {
    this.emit('error', message, context, { trace });
  }
  debug(message: any, context?: string) { this.emit('debug', message, context); }
  verbose(message: any, context?: string) { this.emit('verbose', message, context); }

  private emit(level: LogLevel, message: any, context?: string, extra?: Record<string, unknown>) {
    const out = {
      ts: new Date().toISOString(),
      level,
      traceId: currentTraceId(),
      context: context ?? this.context,
      msg: typeof message === 'string' ? message : JSON.stringify(message),
      ...(extra ?? {}),
    };
    // eslint-disable-next-line no-console
    (level === 'error' || level === 'warn' ? console.error : console.log)(JSON.stringify(out));
  }
}
