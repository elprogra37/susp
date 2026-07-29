import {
  formatIssues,
  USI_VERSION,
  validateCreateContent,
  validateCreateInteraction,
  validateCreateUser,
  validatePurgeRequest,
  validateSendMessage,
  type UsiCapability,
} from '@susp/usi-spec';
import { MemoryIdempotencyStore, MemoryPurgeTokenStore } from './stores.ts';
import type { StoredMarker, UsiHandlerConfig } from './types.ts';

/**
 * Construye un handler USI conforme a partir de tu store.
 *
 * Devuelve una función `(Request) => Promise<Response>` con la firma estándar
 * de la Web, así que corre tal cual en una **Supabase Edge Function (Deno)**,
 * en Cloudflare Workers, en Bun o detrás de un adaptador en Node.
 *
 * El helper se queda con las partes críticas del contrato —el marcado
 * sintético, el rechazo de objetivos no sintéticos, el nonce de purga, la
 * idempotencia— para que no dependan de que cada integrador se acuerde. Tu
 * store solo dice cómo guardar y cómo borrar.
 */
export function createUsiHandler(
  config: UsiHandlerConfig,
): (request: Request) => Promise<Response> {
  const basePath = (config.basePath ?? '/usi/v1').replace(/\/+$/, '');
  const purgeTtl = config.purgeTokenTtlMs ?? 15 * 60_000;
  const idempotency = config.idempotencyStore ?? new MemoryIdempotencyStore();
  const purgeTokens = config.purgeTokenStore ?? new MemoryPurgeTokenStore();

  assertManifestMatchesStore(config);

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (!path.startsWith(basePath)) {
      return error(404, 'not_found', `La API USI vive en ${basePath}.`);
    }

    if (!authorized(request, config.token)) {
      return error(401, 'unauthenticated', 'Token inválido o ausente.');
    }

    const route = path.slice(basePath.length) || '/';
    const method = request.method.toUpperCase();

    let body: Record<string, unknown> = {};
    if (method !== 'GET' && method !== 'DELETE') {
      const parsed = await readJson(request);
      if (!parsed.ok) return parsed.response;
      body = parsed.value;
    }

    const idempotencyKey = request.headers.get('idempotency-key') ?? undefined;

    try {
      return await route_(route, method, body, idempotencyKey, url);
    } catch (err) {
      // Un error del store no debería filtrar detalles internos al cliente,
      // pero sí tiene que quedar en el log de la app.
      console.error('[usi] error no controlado:', err);
      return error(500, 'internal_error', 'Error interno de la aplicación.');
    }
  };

  // ─────────────────────────────── enrutado ───────────────────────────────

  async function route_(
    route: string,
    method: string,
    body: Record<string, unknown>,
    idempotencyKey: string | undefined,
    url: URL,
  ): Promise<Response> {
    const userMatch = /^\/users\/([^/]+)$/.exec(route);
    if (userMatch) {
      const id = decodeURIComponent(userMatch[1]);
      if (method === 'PATCH') return updateUser(id, body);
      if (method === 'DELETE') return deleteUser(id);
      return error(405, 'invalid_request', `Método ${method} no permitido acá.`);
    }

    switch (`${method} ${route}`) {
      case 'GET /manifest':
        return json(200, { ...config.manifest, usi_version: config.manifest.usi_version || USI_VERSION });
      case 'POST /auth/verify':
        return json(200, {
          authenticated: true,
          app_id: config.manifest.app.name,
          scopes: config.manifest.capabilities,
          token_expires_at: null,
        });
      case 'GET /state':
        return state();
      case 'POST /purge':
        return purge(body);
      case 'POST /users':
        return createUser(body, idempotencyKey);
      case 'POST /content':
        return createContent(body, idempotencyKey);
      case 'POST /interactions':
        return createInteraction(body, idempotencyKey);
      case 'POST /messages':
        return sendMessage(body, idempotencyKey);
      case 'GET /audit':
        return audit(url);
      default:
        return error(404, 'not_found', `Sin ruta para ${method} ${route}.`);
    }
  }

  // ─────────────────────────────── endpoints ───────────────────────────────

  async function state(): Promise<Response> {
    const [counts, bySimulation, token] = await Promise.all([
      config.store.counts(),
      config.store.bySimulation?.() ?? Promise.resolve(undefined),
      purgeTokens.issue(purgeTtl),
    ]);

    return json(200, {
      healthy: true,
      usi_version: config.manifest.usi_version || USI_VERSION,
      counts,
      ...(bySimulation ? { by_simulation: bySimulation } : {}),
      purge_token: token.token,
      purge_token_expires_at: new Date(token.expiresAt).toISOString(),
      server_time: new Date().toISOString(),
    });
  }

  async function purge(body: Record<string, unknown>): Promise<Response> {
    const validation = validatePurgeRequest(body);
    if (!validation.ok) {
      // Sin token es 403 y no 400: la falta del nonce es un problema de permiso,
      // no de forma, y conviene que se lea así en los logs.
      const missingToken = validation.issues.some((issue) => issue.path === 'purge_token');
      return missingToken
        ? error(
            403,
            'forbidden',
            'Falta purge_token. Pedí uno en GET /state: es un nonce de un solo uso, ' +
              'justamente para que un borrado masivo no pueda dispararse por accidente.',
          )
        : error(400, 'invalid_request', 'Petición de purga inválida.', {
            issues: validation.issues,
          });
    }

    const consumed = await purgeTokens.consume(validation.value.purge_token);
    if (!consumed) {
      return error(
        403,
        'forbidden',
        'El purge_token no existe, ya fue usado o venció. Pedí uno nuevo en GET /state.',
      );
    }

    const dryRun = validation.value.dry_run === true;
    const scope = validation.value.scope;
    const purged = await config.store.purge(
      scope === 'simulation' ? validation.value.simulation_id : undefined,
      dryRun,
    );

    return json(200, { purged, dry_run: dryRun, completed_at: new Date().toISOString() });
  }

  async function createUser(
    body: Record<string, unknown>,
    idempotencyKey: string | undefined,
  ): Promise<Response> {
    const cached = await replay(idempotencyKey);
    if (cached) return json(201, cached);

    const validation = validateCreateUser(body);
    if (!validation.ok) {
      return error(422, 'unprocessable', `Petición inválida:\n${formatIssues(validation.issues)}`, {
        issues: validation.issues,
      });
    }

    const marker = buildMarker(validation.value.simulation_id, validation.value.agent_id);
    const created = await config.store.createUser(validation.value, marker);
    const payload = { id: created.id, ...marker, ...(created.external_ref ? { external_ref: created.external_ref } : {}), created_at: new Date().toISOString() };

    await remember(idempotencyKey, payload);
    await notify('users.create', 'user', created.id, marker);
    return json(201, payload);
  }

  async function updateUser(id: string, body: Record<string, unknown>): Promise<Response> {
    if (!config.store.updateUser) {
      return error(501, 'capability_not_supported', 'Esta app no implementa users.update.');
    }
    const updated = await config.store.updateUser(id, body as never);
    if (!updated) return error(404, 'not_found', `No existe el usuario ${id}.`);

    // El marcado se relee del store: la respuesta de una actualización también
    // tiene que traerlo, y la suite de conformidad lo verifica.
    const marker = await config.store.getMarker('user', id);
    if (!marker) {
      return error(422, 'unprocessable', `El usuario ${id} no es una entidad sintética.`);
    }
    return json(200, { id, ...marker });
  }

  async function deleteUser(id: string): Promise<Response> {
    if (!config.store.deleteUser) {
      return error(501, 'capability_not_supported', 'Esta app no implementa users.delete.');
    }
    const deleted = await config.store.deleteUser(id);
    return deleted
      ? new Response(null, { status: 204, headers: versionHeader() })
      : error(404, 'not_found', `No existe el usuario ${id}.`);
  }

  async function createContent(
    body: Record<string, unknown>,
    idempotencyKey: string | undefined,
  ): Promise<Response> {
    if (!config.store.createContent) {
      return error(501, 'capability_not_supported', 'Esta app no implementa content.create.');
    }
    const cached = await replay(idempotencyKey);
    if (cached) return json(201, cached);

    const validation = validateCreateContent(body);
    if (!validation.ok) {
      return error(422, 'unprocessable', 'Petición inválida.', { issues: validation.issues });
    }

    // El autor tiene que ser sintético: si no, un agente estaría publicando
    // en nombre de una persona real.
    if (!(await esSintetica('user', validation.value.author_id))) {
      return rejected(
        `El autor ${validation.value.author_id} no es un usuario sintético.`,
        { author_id: validation.value.author_id },
        'content.create',
        validation.value.simulation_id,
      );
    }

    if (
      config.manifest.content_types &&
      !config.manifest.content_types.includes(validation.value.type)
    ) {
      return error(
        422,
        'unprocessable',
        `Tipo "${validation.value.type}" no soportado. Declarados: ${config.manifest.content_types.join(', ')}.`,
      );
    }

    const marker = buildMarker(validation.value.simulation_id, validation.value.agent_id);
    const created = await config.store.createContent(validation.value, marker);
    const payload = { id: created.id, ...marker, created_at: new Date().toISOString() };

    await remember(idempotencyKey, payload);
    await notify('content.create', 'content', created.id, marker);
    return json(201, payload);
  }

  async function createInteraction(
    body: Record<string, unknown>,
    idempotencyKey: string | undefined,
  ): Promise<Response> {
    if (!config.store.createInteraction) {
      return error(501, 'capability_not_supported', 'Esta app no implementa interactions.create.');
    }
    const cached = await replay(idempotencyKey);
    if (cached) return json(201, cached);

    const validation = validateCreateInteraction(body);
    if (!validation.ok) {
      return error(422, 'unprocessable', 'Petición inválida.', { issues: validation.issues });
    }

    const input = validation.value;

    if (!(await esSintetica('user', input.actor_id))) {
      return rejected(
        `El actor ${input.actor_id} no es un usuario sintético.`,
        { actor_id: input.actor_id },
        'interactions.create',
        input.simulation_id,
      );
    }

    // **La regla que sostiene todo el modelo.** Un agente sintético no puede
    // tocar una entidad real. El helper lo garantiza para que no dependa de que
    // cada integrador se acuerde de comprobarlo.
    if (!(await esSintetica(input.target_type, input.target_id))) {
      return rejected(
        `El objetivo ${input.target_id} no es una entidad sintética. ` +
          'Los agentes solo pueden interactuar entre ellos.',
        { target_id: input.target_id, target_type: input.target_type },
        'interactions.create',
        input.simulation_id,
      );
    }

    const marker = buildMarker(input.simulation_id, input.agent_id);
    const created = await config.store.createInteraction(input, marker);
    const payload = { id: created.id, ...marker, created_at: new Date().toISOString() };

    await remember(idempotencyKey, payload);
    await notify('interactions.create', 'interaction', created.id, marker);
    return json(201, payload);
  }

  async function sendMessage(
    body: Record<string, unknown>,
    idempotencyKey: string | undefined,
  ): Promise<Response> {
    if (!config.store.sendMessage) {
      return error(501, 'capability_not_supported', 'Esta app no implementa messaging.send.');
    }
    const cached = await replay(idempotencyKey);
    if (cached) return json(201, cached);

    const validation = validateSendMessage(body);
    if (!validation.ok) {
      return error(422, 'unprocessable', 'Petición inválida.', { issues: validation.issues });
    }

    const input = validation.value;

    if (!(await esSintetica('user', input.from_id))) {
      return rejected(
        `El emisor ${input.from_id} no es sintético.`,
        { from_id: input.from_id },
        'messaging.send',
        input.simulation_id,
      );
    }
    for (const to of input.to_ids) {
      if (!(await esSintetica('user', to))) {
        return rejected(
          `El destinatario ${to} no es un usuario sintético. Un agente no puede ` +
            'escribirle a una persona real.',
          { target_id: to },
          'messaging.send',
          input.simulation_id,
        );
      }
    }

    const marker = buildMarker(input.simulation_id, input.agent_id);
    const sent = await config.store.sendMessage(input, marker);
    const payload = {
      id: sent.id,
      conversation_id: sent.conversation_id,
      ...marker,
      created_at: new Date().toISOString(),
    };

    await remember(idempotencyKey, payload);
    await notify('messaging.send', 'message', sent.id, marker);
    return json(201, payload);
  }

  async function audit(url: URL): Promise<Response> {
    if (!config.store.audit) {
      return error(501, 'capability_not_supported', 'Esta app no implementa audit.read.');
    }
    const page = await config.store.audit({
      simulationId: url.searchParams.get('simulation_id') ?? undefined,
      since: url.searchParams.get('since') ?? undefined,
      limit: Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 1000),
      cursor: url.searchParams.get('cursor') ?? undefined,
    });
    return json(200, page);
  }

  // ─────────────────────────────── auxiliares ───────────────────────────────

  function buildMarker(simulationId: string, agentId: string): StoredMarker {
    return {
      synthetic: true,
      simulation_id: simulationId,
      agent_id: agentId,
      created_by: 'susp',
    };
  }

  /** ¿Es sintética? Se deriva de `getMarker`: una sola fuente de verdad. */
  async function esSintetica(type: string, id: string): Promise<boolean> {
    return (await config.store.getMarker(type, id)) !== null;
  }

  async function replay(key: string | undefined): Promise<unknown | undefined> {
    return key ? idempotency.get(key) : undefined;
  }

  async function remember(key: string | undefined, value: unknown): Promise<void> {
    if (key) await idempotency.set(key, value);
  }

  async function notify(
    operation: string,
    entityType: string,
    entityId: string,
    marker: StoredMarker,
  ): Promise<void> {
    await config.onOperation?.({
      operation,
      entityType,
      entityId,
      simulationId: marker.simulation_id,
      agentId: marker.agent_id,
      result: 'ok',
    });
  }

  async function rejected(
    message: string,
    details: Record<string, unknown>,
    operation: string,
    simulationId: string,
  ): Promise<Response> {
    await config.onOperation?.({
      operation,
      entityType: 'unknown',
      entityId: String(Object.values(details)[0] ?? ''),
      simulationId,
      result: 'rejected',
    });
    return error(422, 'target_not_synthetic', message, details);
  }
}

// ─────────────────────────────── utilidades ───────────────────────────────

function versionHeader(): Record<string, string> {
  return { 'x-usi-version': USI_VERSION };
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...versionHeader() },
  });
}

function error(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return json(status, { error: { code, message, ...(details ? { details } : {}) } });
}

/** Comparación en tiempo constante: no filtra el token por temporización. */
function authorized(request: Request, expected: string): boolean {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;

  const provided = header.slice(7);
  if (provided.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function readJson(
  request: Request,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: error(400, 'invalid_request', 'No se pudo leer el cuerpo.') };
  }

  if (raw.trim() === '') return { ok: true, value: {} };

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        response: error(400, 'invalid_request', 'El cuerpo tiene que ser un objeto JSON.'),
      };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, response: error(400, 'invalid_request', 'El cuerpo no es JSON válido.') };
  }
}

/**
 * Declarar una capacidad que no está implementada es la forma más silenciosa de
 * romper una integración: el motor la planifica, la app devuelve 501 y la
 * campaña se llena de errores. Se detecta al construir el handler, no en la
 * primera campaña.
 */
function assertManifestMatchesStore(config: UsiHandlerConfig): void {
  const implemented: Record<UsiCapability, boolean> = {
    'users.create': typeof config.store.createUser === 'function',
    'users.update': typeof config.store.updateUser === 'function',
    'users.delete': typeof config.store.deleteUser === 'function',
    'content.create': typeof config.store.createContent === 'function',
    'interactions.create': typeof config.store.createInteraction === 'function',
    'messaging.send': typeof config.store.sendMessage === 'function',
    'audit.read': typeof config.store.audit === 'function',
  };

  const faltantes = config.manifest.capabilities.filter(
    (capability) => !implemented[capability],
  );

  if (faltantes.length > 0) {
    throw new Error(
      `El manifiesto declara capacidades que el store no implementa: ${faltantes.join(', ')}. ` +
        'O las implementás, o las sacás del manifiesto — declarar de más hace que el ' +
        'motor planifique trabajo que después falla con 501.',
    );
  }
}
