export type SuspErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'rate_limited'
  | 'invalid_request'
  | 'invalid_response'
  | 'server_error'
  | 'unknown';

/** Error del SDK. Conserva el cuerpo del motor para poder diagnosticar. */
export class SuspError extends Error {
  readonly kind: SuspErrorKind;
  readonly httpStatus?: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(
    kind: SuspErrorKind,
    message: string,
    httpStatus?: number,
    code?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'SuspError';
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.code = code;
    this.details = details;
  }

  /** Solo se reintenta lo que puede resolverse solo. */
  get retryable(): boolean {
    return (
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'rate_limited' ||
      this.kind === 'server_error'
    );
  }

  static fromResponse(status: number, raw: string): SuspError {
    let code: string | undefined;
    let message = `El motor respondió ${status}.`;
    let details: unknown;

    try {
      const parsed = JSON.parse(raw) as {
        error?: { code?: string; message?: string; details?: unknown };
      };
      if (parsed.error) {
        code = parsed.error.code;
        message = parsed.error.message ?? message;
        details = parsed.error.details;
      }
    } catch {
      if (raw) details = { raw: raw.slice(0, 500) };
    }

    const kind: SuspErrorKind =
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
                  : status === 400
                    ? 'invalid_request'
                    : status >= 500
                      ? 'server_error'
                      : 'unknown';

    return new SuspError(kind, message, status, code, details);
  }
}
