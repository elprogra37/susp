import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Formato de error único para toda la API, con la misma forma que exige el
 * estándar USI. Así el motor, el SDK y las apps integradas hablan igual.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.translate(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status} ${body.error.code}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} → ${status} ${body.error.code}: ${body.error.message}`,
      );
    }

    response.status(status).json(body);
  }

  private translate(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      // class-validator devuelve { message: string[] } — se aplana a details.
      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        const raw = record.message;
        const messages = Array.isArray(raw) ? raw.map(String) : undefined;
        return {
          status,
          body: {
            error: {
              code: this.codeFor(status),
              message: messages
                ? 'La petición no pasó la validación.'
                : String(raw ?? exception.message),
              ...(messages ? { details: { issues: messages } } : {}),
            },
          },
        };
      }

      return {
        status,
        body: { error: { code: this.codeFor(status), message: String(payload) } },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.translatePrisma(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: 'internal_error',
          message: 'Error interno del motor.',
        },
      },
    };
  }

  private translatePrisma(err: Prisma.PrismaClientKnownRequestError): {
    status: number;
    body: ErrorBody;
  } {
    const target = (err.meta?.target as string[] | undefined)?.join(', ');
    switch (err.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            error: {
              code: 'conflict',
              message: `Ya existe un registro con ese valor${target ? ` (${target})` : ''}.`,
            },
          },
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: { error: { code: 'not_found', message: 'No se encontró el registro.' } },
        };
      case 'P2003':
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          body: {
            error: {
              code: 'unprocessable',
              message: 'La referencia apunta a un registro inexistente.',
            },
          },
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: {
            error: { code: 'database_error', message: 'Error de base de datos.' },
          },
        };
    }
  }

  private codeFor(status: number): string {
    const map: Record<number, string> = {
      400: 'invalid_request',
      401: 'unauthenticated',
      403: 'forbidden',
      404: 'not_found',
      409: 'conflict',
      422: 'unprocessable',
      429: 'rate_limited',
      501: 'not_implemented',
      503: 'unavailable',
    };
    return map[status] ?? (status >= 500 ? 'internal_error' : 'error');
  }
}
