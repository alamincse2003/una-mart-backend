import { HttpException, HttpStatus } from '@nestjs/common';

// Business errors with a stable machine-readable code, so the storefront can
// react to e.g. OUT_OF_STOCK without parsing messages. Rendered by
// HttpExceptionFilter as { statusCode, code, message } (SYSTEM_DESIGN.md).
export class AppError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
  ) {
    super({ statusCode: status, code, message }, status);
  }
}

export const notFound = (message = 'Not found') => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new AppError(HttpStatus.CONFLICT, code, message);
export const unprocessable = (code: string, message: string) =>
  new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
export const unauthorized = (code = 'UNAUTHORIZED', message = 'Please log in.') =>
  new AppError(HttpStatus.UNAUTHORIZED, code, message);
export const forbidden = (code = 'FORBIDDEN', message = "You don't have access to this.") =>
  new AppError(HttpStatus.FORBIDDEN, code, message);
export const tooManyRequests = (code: string, message: string) =>
  new AppError(HttpStatus.TOO_MANY_REQUESTS, code, message);
