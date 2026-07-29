import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

/**
 * Límite de tasa por tenant, con token bucket en memoria.
 *
 * Alcanza para una sola instancia, que es el modo de despliegue de la v1. Si
 * algún día se corren varias réplicas detrás de un balanceador, esto hay que
 * moverlo a un store compartido (Redis) — está anotado en PENDIENTES.md.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity = 300;
  private readonly refillPerSecond = 5;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.principal?.tenantId ?? request.ip ?? 'anonymous';
    const now = Date.now();

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + elapsedSeconds * this.refillPerSecond,
    );
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const waitSeconds = Math.ceil((1 - bucket.tokens) / this.refillPerSecond);
      throw new HttpException(
        {
          message: `Demasiadas peticiones. Reintentá en ${waitSeconds} s.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.tokens -= 1;
    return true;
  }
}
