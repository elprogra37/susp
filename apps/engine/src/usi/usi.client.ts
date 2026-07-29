import { createHmac, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { UsiError } from './usi.errors';
import type {
  UsiAuditPage,
  UsiAuthVerification,
  UsiCreateContentRequest,
  UsiCreateInteractionRequest,
  UsiCreateUserRequest,
  UsiCreatedEntity,
  UsiManifest,
  UsiPurgeRequest,
  UsiPurgeResult,
  UsiSendMessageRequest,
  UsiSentMessage,
  UsiState,
  UsiUserProfile,
} from './usi.types';

export interface UsiClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  /** Secreto HMAC, si la app declara `requires_signature`. */
  readonly signingSecret?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly simulationId?: string;
  /** Inyectable para poder testear sin red. */
  readonly fetchImpl?: typeof fetch;
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  query?: Record<string, string | number | undefined>;
  /** Las lecturas se pueden reintentar libremente; las escrituras solo con clave de idempotencia. */
  retryable?: boolean;
}

/**
 * Cliente del estándar USI.
 *
 * Es el **único** componente del motor que habla con el exterior, así que
 * concentra todo lo que tiene que ver con hablar con una app ajena: timeouts,
 * reintentos con backoff, idempotencia, firma HMAC y el marcado sintético
 * obligatorio.
 *
 * El marcado no es un parámetro: se inyecta acá, en el único camino de salida.
 * No hay forma de que una escritura salga del motor sin quedar identificada.
 */
export class UsiClient {
  private readonly logger = new Logger(UsiClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: UsiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.doFetch = options.fetchImpl ?? globalThis.fetch;
  }

  // ───────────────────────── obligatorios ─────────────────────────

  manifest(): Promise<UsiManifest> {
    return this.request<UsiManifest>({
      method: 'GET',
      path: '/manifest',
      retryable: true,
    });
  }

  verifyAuth(): Promise<UsiAuthVerification> {
    return this.request<UsiAuthVerification>({
      method: 'POST',
      path: '/auth/verify',
      body: {},
      retryable: true,
    });
  }

  state(): Promise<UsiState> {
    return this.request<UsiState>({
      method: 'GET',
      path: '/state',
      retryable: true,
    });
  }

  purge(body: UsiPurgeRequest): Promise<UsiPurgeResult> {
    // Sin reintento: el token de purga es de un solo uso, así que un reintento
    // fallaría con 403 y confundiría el diagnóstico.
    return this.request<UsiPurgeResult>({
      method: 'POST',
      path: '/purge',
      body,
      retryable: false,
    });
  }

  // ───────────────────── según capacidades ─────────────────────

  createUser(
    body: UsiCreateUserRequest,
    idempotencyKey: string,
  ): Promise<UsiCreatedEntity> {
    return this.request<UsiCreatedEntity>({
      method: 'POST',
      path: '/users',
      body,
      idempotencyKey,
      retryable: true,
    });
  }

  updateUser(
    id: string,
    profile: Partial<UsiUserProfile>,
    idempotencyKey: string,
  ): Promise<UsiCreatedEntity> {
    return this.request<UsiCreatedEntity>({
      method: 'PATCH',
      path: `/users/${encodeURIComponent(id)}`,
      body: { profile },
      idempotencyKey,
      retryable: true,
    });
  }

  deleteUser(id: string, idempotencyKey: string): Promise<void> {
    return this.request<void>({
      method: 'DELETE',
      path: `/users/${encodeURIComponent(id)}`,
      idempotencyKey,
      retryable: true,
    });
  }

  createContent(
    body: UsiCreateContentRequest,
    idempotencyKey: string,
  ): Promise<UsiCreatedEntity> {
    return this.request<UsiCreatedEntity>({
      method: 'POST',
      path: '/content',
      body,
      idempotencyKey,
      retryable: true,
    });
  }

  createInteraction(
    body: UsiCreateInteractionRequest,
    idempotencyKey: string,
  ): Promise<UsiCreatedEntity> {
    return this.request<UsiCreatedEntity>({
      method: 'POST',
      path: '/interactions',
      body,
      idempotencyKey,
      retryable: true,
    });
  }

  sendMessage(
    body: UsiSendMessageRequest,
    idempotencyKey: string,
  ): Promise<UsiSentMessage> {
    return this.request<UsiSentMessage>({
      method: 'POST',
      path: '/messages',
      body,
      idempotencyKey,
      retryable: true,
    });
  }

  audit(params: {
    simulationId?: string;
    since?: string;
    limit?: number;
    cursor?: string;
  }): Promise<UsiAuditPage> {
    return this.request<UsiAuditPage>({
      method: 'GET',
      path: '/audit',
      query: {
        simulation_id: params.simulationId,
        since: params.since,
        limit: params.limit,
        cursor: params.cursor,
      },
      retryable: true,
    });
  }

  // ───────────────────────── transporte ─────────────────────────

  private async request<T>(options: RequestOptions): Promise<T> {
    const url = this.buildUrl(options.path, options.query);
    const rawBody = options.body === undefined ? undefined : JSON.stringify(options.body);
    const maxAttempts = options.retryable ? this.maxRetries + 1 : 1;

    let lastError: UsiError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.attempt<T>(url, options, rawBody);
      } catch (err) {
        const error = err instanceof UsiError ? err : new UsiError('unknown', String(err));
        lastError = error;

        if (!error.retryable || attempt === maxAttempts) {
          throw error;
        }

        // Backoff exponencial con jitter. Si la app mandó Retry-After, manda ella.
        const backoff = error.retryAfterMs ?? Math.min(2 ** (attempt - 1) * 500, 8_000);
        const jitter = Math.random() * 250;
        this.logger.warn(
          `${options.method} ${options.path} falló (${error.kind}); reintento ${attempt}/${this.maxRetries} en ${Math.round(backoff + jitter)} ms`,
        );
        await sleep(backoff + jitter);
      }
    }

    throw lastError ?? new UsiError('unknown', 'Fallo sin diagnóstico.');
  }

  private async attempt<T>(
    url: string,
    options: RequestOptions,
    rawBody: string | undefined,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.doFetch(url, {
        method: options.method,
        headers: this.buildHeaders(options, rawBody),
        body: rawBody,
        signal: controller.signal,
      });

      if (response.status === 204) {
        return undefined as T;
      }

      const text = await response.text();

      if (!response.ok) {
        throw this.toError(response, text);
      }

      if (text.trim() === '') {
        return undefined as T;
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new UsiError(
          'invalid_response',
          `La app devolvió ${response.status} con un cuerpo que no es JSON válido.`,
          response.status,
        );
      }
    } catch (err) {
      if (err instanceof UsiError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new UsiError(
          'timeout',
          `La app no respondió en ${this.timeoutMs} ms.`,
        );
      }
      throw new UsiError(
        'network',
        `No se pudo contactar la app: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private toError(response: Response, text: string): UsiError {
    let code: string | undefined;
    let message = `La app respondió ${response.status}.`;
    let details: unknown;

    try {
      const parsed = JSON.parse(text) as { error?: { code?: string; message?: string; details?: unknown } };
      if (parsed.error) {
        code = parsed.error.code;
        message = parsed.error.message ?? message;
        details = parsed.error.details;
      }
    } catch {
      // Cuerpo no-JSON: se conserva un extracto para poder diagnosticar.
      if (text) details = { raw: text.slice(0, 500) };
    }

    const retryAfter = response.headers.get('retry-after');
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;

    return UsiError.fromStatus(
      response.status,
      code,
      message,
      details,
      Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
    );
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private buildHeaders(
    options: RequestOptions,
    rawBody: string | undefined,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${this.options.token}`,
      // Redundante con el cuerpo a propósito: permite filtrar tráfico sintético
      // en un proxy o WAF sin tener que inspeccionar el payload.
      'x-usi-synthetic': 'true',
      'user-agent': 'susp-engine/0.1 (+https://github.com/elprogra37/susp)',
    };

    if (this.options.simulationId) {
      headers['x-usi-simulation-id'] = this.options.simulationId;
    }
    if (rawBody !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (options.idempotencyKey) {
      headers['idempotency-key'] = options.idempotencyKey;
    }
    if (this.options.signingSecret && rawBody !== undefined) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac('sha256', this.options.signingSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');
      headers['x-usi-timestamp'] = timestamp;
      headers['x-usi-signature'] = `sha256=${signature}`;
    }

    return headers;
  }

  static newIdempotencyKey(): string {
    return randomUUID();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
