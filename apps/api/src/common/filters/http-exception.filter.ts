import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : 500;
    const errorResponse = isHttp ? exception.getResponse() : null;
    const hasObjectResponse =
      typeof errorResponse === 'object' && errorResponse !== null;

    const body = {
      code: hasObjectResponse
        ? ((errorResponse as any).code ?? 'INTERNAL_ERROR')
        : 'INTERNAL_ERROR',
      message:
        typeof errorResponse === 'string'
          ? errorResponse
          : hasObjectResponse
            ? ((errorResponse as any).message ?? 'Internal server error')
            : 'Internal server error',
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (!isHttp) {
      this.logger.error(
        `Unhandled exception: ${exception}`,
        (exception as Error).stack
      );
    }

    response.status(status).json(body);
  }
}
