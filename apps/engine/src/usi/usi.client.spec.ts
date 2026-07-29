import { UsiClient } from './usi.client';
import { UsiError } from './usi.errors';

interface Recorded {
  url: string;
  init: RequestInit;
}

function fakeFetch(
  responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>,
): { impl: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let index = 0;

  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const spec = responses[Math.min(index, responses.length - 1)];
    index += 1;
    // 204/205/304 no admiten cuerpo: el constructor de Response lo rechaza.
    const bodyless = spec.status === 204 || spec.status === 205 || spec.status === 304;
    const body = bodyless || spec.body === undefined ? null : JSON.stringify(spec.body);
    return new Response(body, {
      status: spec.status,
      headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function clientWith(impl: typeof fetch, overrides: Record<string, unknown> = {}): UsiClient {
  return new UsiClient({
    baseUrl: 'https://app.example/usi/v1',
    token: 'tok_123',
    fetchImpl: impl,
    maxRetries: 2,
    timeoutMs: 1000,
    simulationId: 'run_abc',
    ...overrides,
  });
}

describe('UsiClient', () => {
  describe('marcado sintético', () => {
    it('manda siempre X-USI-Synthetic: true', async () => {
      const { impl, calls } = fakeFetch([{ status: 200, body: { healthy: true } }]);
      await clientWith(impl).state();

      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['x-usi-synthetic']).toBe('true');
    });

    it('manda el id de simulación cuando está configurado', async () => {
      const { impl, calls } = fakeFetch([{ status: 200, body: {} }]);
      await clientWith(impl).state();

      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['x-usi-simulation-id']).toBe('run_abc');
    });

    it('manda el bearer token', async () => {
      const { impl, calls } = fakeFetch([{ status: 200, body: {} }]);
      await clientWith(impl).state();

      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer tok_123');
    });
  });

  describe('idempotencia', () => {
    it('propaga la clave en las escrituras', async () => {
      const { impl, calls } = fakeFetch([{ status: 201, body: { id: 'usr_1' } }]);
      await clientWith(impl).createUser(
        {
          agent_id: 'agt_1',
          simulation_id: 'run_abc',
          profile: { display_name: 'Test' },
        },
        'clave-idem-1',
      );

      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['idempotency-key']).toBe('clave-idem-1');
    });

    it('genera claves distintas en cada llamada', () => {
      expect(UsiClient.newIdempotencyKey()).not.toBe(UsiClient.newIdempotencyKey());
    });
  });

  describe('reintentos', () => {
    it('reintenta ante 503 y devuelve el resultado del intento exitoso', async () => {
      const { impl, calls } = fakeFetch([
        { status: 503, body: { error: { code: 'unavailable', message: 'caído' } } },
        { status: 200, body: { healthy: true, usi_version: '1.0.0' } },
      ]);

      const result = await clientWith(impl).state();

      expect(calls).toHaveLength(2);
      expect(result.healthy).toBe(true);
    });

    it('NO reintenta ante 422: la app rechazó por reglas de negocio', async () => {
      const { impl, calls } = fakeFetch([
        {
          status: 422,
          body: {
            error: { code: 'target_not_synthetic', message: 'El objetivo no es sintético.' },
          },
        },
      ]);

      await expect(
        clientWith(impl).createInteraction(
          {
            agent_id: 'agt_1',
            simulation_id: 'run_abc',
            actor_id: 'usr_1',
            type: 'like',
            target_type: 'content',
            target_id: 'cnt_real',
          },
          'clave',
        ),
      ).rejects.toMatchObject({ kind: 'unprocessable', code: 'target_not_synthetic' });

      expect(calls).toHaveLength(1);
    });

    it('NO reintenta la purga: el token es de un solo uso', async () => {
      const { impl, calls } = fakeFetch([
        { status: 503, body: { error: { code: 'unavailable', message: 'caído' } } },
      ]);

      await expect(
        clientWith(impl).purge({ purge_token: 'prg_1', scope: 'all' }),
      ).rejects.toBeInstanceOf(UsiError);

      expect(calls).toHaveLength(1);
    });

    it('se rinde después de agotar los reintentos', async () => {
      const { impl, calls } = fakeFetch([{ status: 503, body: {} }]);

      await expect(clientWith(impl).state()).rejects.toMatchObject({ kind: 'unavailable' });

      // 1 intento inicial + 2 reintentos
      expect(calls).toHaveLength(3);
    });
  });

  describe('traducción de errores', () => {
    it.each([
      [401, 'unauthenticated'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [409, 'conflict'],
      [422, 'unprocessable'],
      [501, 'capability_not_supported'],
    ])('mapea %i a %s', async (status, kind) => {
      const { impl } = fakeFetch([{ status, body: { error: { message: 'x' } } }]);
      await expect(clientWith(impl).manifest()).rejects.toMatchObject({ kind });
    });

    it('conserva code, message y details del cuerpo de error', async () => {
      const { impl } = fakeFetch([
        {
          status: 422,
          body: {
            error: {
              code: 'target_not_synthetic',
              message: 'usr_9 no es sintético.',
              details: { target_id: 'usr_9' },
            },
          },
        },
      ]);

      await expect(clientWith(impl).manifest()).rejects.toMatchObject({
        code: 'target_not_synthetic',
        message: 'usr_9 no es sintético.',
        details: { target_id: 'usr_9' },
      });
    });

    it('marca como retryable solo lo que puede resolverse solo', () => {
      expect(new UsiError('unavailable', '').retryable).toBe(true);
      expect(new UsiError('rate_limited', '').retryable).toBe(true);
      expect(new UsiError('timeout', '').retryable).toBe(true);
      expect(new UsiError('network', '').retryable).toBe(true);
      expect(new UsiError('unprocessable', '').retryable).toBe(false);
      expect(new UsiError('forbidden', '').retryable).toBe(false);
    });
  });

  describe('respuestas sin cuerpo', () => {
    it('acepta 204 en el borrado', async () => {
      const { impl } = fakeFetch([{ status: 204 }]);
      await expect(clientWith(impl).deleteUser('usr_1', 'clave')).resolves.toBeUndefined();
    });

    it('falla con un 200 que no trae JSON válido', async () => {
      const impl = (async () =>
        new Response('no soy json', { status: 200 })) as unknown as typeof fetch;

      await expect(clientWith(impl).manifest()).rejects.toMatchObject({
        kind: 'invalid_response',
      });
    });
  });

  describe('firma HMAC', () => {
    it('firma el cuerpo cuando hay secreto configurado', async () => {
      const { impl, calls } = fakeFetch([{ status: 201, body: { id: 'usr_1' } }]);
      const client = clientWith(impl, { signingSecret: 'secreto-hmac-de-prueba' });

      await client.createUser(
        { agent_id: 'a', simulation_id: 'r', profile: { display_name: 'X' } },
        'clave',
      );

      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['x-usi-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(headers['x-usi-timestamp']).toMatch(/^\d+$/);
    });

    it('no firma si no hay secreto', async () => {
      const { impl, calls } = fakeFetch([{ status: 200, body: {} }]);
      await clientWith(impl).state();

      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['x-usi-signature']).toBeUndefined();
    });
  });

  describe('construcción de la URL', () => {
    it('no duplica la barra al unir base y ruta', async () => {
      const { impl, calls } = fakeFetch([{ status: 200, body: {} }]);
      const client = clientWith(impl, { baseUrl: 'https://app.example/usi/v1/' });
      await client.state();

      expect(calls[0].url).toBe('https://app.example/usi/v1/state');
    });

    it('agrega solo los parámetros con valor', async () => {
      const { impl, calls } = fakeFetch([{ status: 200, body: { events: [] } }]);
      await clientWith(impl).audit({ simulationId: 'run_abc', limit: 10 });

      const url = new URL(calls[0].url);
      expect(url.searchParams.get('simulation_id')).toBe('run_abc');
      expect(url.searchParams.get('limit')).toBe('10');
      expect(url.searchParams.has('since')).toBe(false);
    });
  });
});
