import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './app-error.js';

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE',
  429: 'TOO_MANY_REQUESTS',
};

// Every error leaves the API as { statusCode, code, message }
// (SYSTEM_DESIGN.md → API surface). Unexpected errors are logged and
// returned as a generic 500 — no stack traces or internals leak.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      const status = exception.getStatus();
      res.status(status).json({ statusCode: status, code: exception.code, message: exception.message });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as string | { message?: string | string[] };
      const raw = typeof body === 'string' ? body : body.message;
      // ValidationPipe puts one message per failed field in an array.
      const isValidation = status === HttpStatus.BAD_REQUEST && Array.isArray(raw);
      res.status(status).json({
        statusCode: status,
        code: isValidation ? 'VALIDATION_FAILED' : (DEFAULT_CODES[status] ?? 'ERROR'),
        message: Array.isArray(raw) ? raw.join('; ') : (raw ?? exception.message),
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
    });
  }
}
