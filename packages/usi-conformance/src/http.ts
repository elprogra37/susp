/** Cliente HTTP mínimo para la suite. Sin dependencias, solo `fetch`. */

export interface UsiResponse<T = unknown> {
  status: number;
  headers: Headers;
  body: T | null;
  /** Cuerpo crudo, para poder diagnosticar cuando no es JSON. */
  raw: string;
  durationMs: number;
}

export class SuiteHttp {
  // Campos explícitos en vez de "parameter properties": el borrado de tipos de
  // Node es strip-only y no transforma azúcar sintáctico de TypeScript.
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly simulationId: string;

  constructor(baseUrl: string, token: string, timeoutMs: number, simulationId: string) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.simulationId = simulationId;
  }

  get<T>(path: string, query?: Record<string, string>): Promise<UsiResponse<T>> {
    return this.request<T>('GET', path, undefined, { query });
  }

  post<T>(
    path: string,
    body: unknown,
    opts: { idempotencyKey?: string; token?: string } = {},
  ): Promise<UsiResponse<T>> {
    return this.request<T>('POST', path, body, opts);
  }

  patch<T>(path: string, body: unknown): Promise<UsiResponse<T>> {
    return this.request<T>('PATCH', path, body);
  }

  delete<T>(path: string): Promise<UsiResponse<T>> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: {
      idempotencyKey?: string;
      token?: string;
      query?: Record<string, string>;
    } = {},
  ): Promise<UsiResponse<T>> {
    const url = new URL(this.baseUrl.replace(/\/+$/, '') + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();

    const headers: Record<string, string> = {
      accept: 'application/json',
      // `token: ''` es distinto de "sin token": permite probar el rechazo.
      ...(opts.token === undefined
        ? { authorization: `Bearer ${this.token}` }
        : opts.token === ''
          ? {}
          : { authorization: `Bearer ${opts.token}` }),
      'x-usi-synthetic': 'true',
      'x-usi-simulation-id': this.simulationId,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const raw = response.status === 204 ? '' : await response.text();
      let parsed: T | null = null;
      if (raw.trim() !== '') {
        try {
          parsed = JSON.parse(raw) as T;
        } catch {
          parsed = null;
        }
      }

      return {
        status: response.status,
        headers: response.headers,
        body: parsed,
        raw,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
