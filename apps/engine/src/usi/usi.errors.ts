/** Errores del cliente USI, con la semántica que define docs/USI.md §5. */

export type UsiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'rate_limited'
  | 'capability_not_supported'
  | 'unavailable'
  | 'invalid_response'
  | 'circuit_open'
  | 'unknown';

export class UsiError extends Error {
  constructor(
    readonly kind: UsiErrorKind,
    message: string,
    readonly httpStatus?: number,
    readonly code?: string,
    readonly details?: unknown,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'UsiError';
  }

  /**
   * Solo se reintenta lo que puede cambiar por sí solo. Un 422 significa que la
   * app rechazó la operación por sus reglas de negocio: repetirla da lo mismo.
   */
  get retryable(): boolean {
    return (
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'rate_limited' ||
      this.kind === 'unavailable'
    );
  }

  static fromStatus(status: number, code: string | undefined, message: string, details?: unknown, retryAfterMs?: number): UsiError {
    const kind: UsiErrorKind =
      status === 401
        ? 'unauthenticated'
        : status === 403
          ? 'forbidden'
          : status === 404
            ? 'not_found'
            : status === 409
              ? 'conflict'
              : status === 422
                ? 'unprocessable'
                : status === 429
                  ? 'rate_limited'
                  : status === 501
                    ? 'capability_not_supported'
                    : status === 503 || status >= 500
                      ? 'unavailable'
                      : 'unknown';
    return new UsiError(kind, message, status, code, details, retryAfterMs);
  }
}
