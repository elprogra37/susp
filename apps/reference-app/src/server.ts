import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Store } from './store.ts';

/**
 * Implementación de referencia del estándar USI v1.
 *
 * Existe por dos razones:
 *
 * 1. **Correr SUSP de punta a punta sin depender de una app real.** La suite de
 *    conformidad y los tests e2e apuntan acá.
 * 2. **Ser el ejemplo canónico**: cualquiera que tenga que implementar USI en su
 *    app puede leer este archivo y ver exactamente qué se espera, incluidas las
 *    partes que es tentador saltearse — el marcado sintético, el rechazo de
 *    objetivos no sintéticos y el nonce de purga.
 *
 * Sin dependencias externas a propósito: solo `node:http`. Implementar USI no
 * requiere ningún framework.
 */

const PORT = Number(process.env.PORT ?? 55704);
const TOKEN = process.env.USI_TOKEN ?? 'reference-token-dev';
const USI_VERSION = '1.0.0';

const store = new Store();

const MANIFEST = {
  usi_version: USI_VERSION,
  app: {
    name: 'susp-reference-app',
    environment: 'development' as const,
    vertical: 'social' as const,
  },
  capabilities: [
    'users.create',
    'users.update',
    'users.delete',
    'content.create',
    'interactions.create',
    'messaging.send',
    'audit.read',
  ],
  requires_signature: false,
  limits: { max_batch_size: 50, requests_per_minute: 6000 },
  content_types: ['post', 'comment', 'photo', 'prompt', 'listing', 'consultation', 'note'],
  interaction_types: ['like', 'pass', 'follow', 'share', 'comment', 'favorite', 'offer', 'rating'],
};

// ─────────────────────────────── utilidades ───────────────────────────────

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  body: Record<string, unknown>;
  query: URLSearchParams;
  idempotencyKey?: string;
}

function send(res: ServerResponse, status: number, payload?: unknown): void {
  res.setHeader('X-USI-Version', USI_VERSION);
  if (payload === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const json = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
  });
  res.end(json);
}

function fail(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  send(res, status, { error: { code, message, ...(details ? { details } : {}) } });
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

/** Campos que toda escritura debe traer. Su ausencia es un `400`. */
function requireSimulation(
  ctx: Ctx,
): { simulationId: string; agentId: string } | null {
  const simulationId = str(ctx.body, 'simulation_id');
  const agentId = str(ctx.body, 'agent_id');
  if (!simulationId || !agentId) {
    fail(
      ctx.res,
      400,
      'invalid_request',
      'Toda escritura necesita simulation_id y agent_id: son parte del marcado sintético obligatorio.',
    );
    return null;
  }
  return { simulationId, agentId };
}

// ─────────────────────────────── endpoints ───────────────────────────────

function getManifest(ctx: Ctx): void {
  send(ctx.res, 200, MANIFEST);
}

function verifyAuth(ctx: Ctx): void {
  send(ctx.res, 200, {
    authenticated: true,
    app_id: MANIFEST.app.name,
    scopes: ['users.write', 'content.write', 'interactions.write', 'messaging.write', 'purge'],
    token_expires_at: null,
  });
}

function createUser(ctx: Ctx): void {
  const ids = requireSimulation(ctx);
  if (!ids) return;

  const replayed = store.replay(ctx.idempotencyKey);
  if (replayed) return send(ctx.res, 201, replayed);

  const profile = (ctx.body.profile ?? {}) as Record<string, unknown>;
  if (typeof profile.display_name !== 'string' || profile.display_name.trim() === '') {
    return fail(ctx.res, 422, 'unprocessable', 'El perfil necesita un display_name.');
  }

  const now = new Date().toISOString();
  const id = `usr_${randomUUID().slice(0, 12)}`;
  const user = {
    id,
    profile,
    attributes: (ctx.body.attributes ?? {}) as Record<string, unknown>,
    created_at: now,
    updated_at: now,
    ...store.marker(ids.simulationId, ids.agentId),
  };

  store.users.set(id, user);
  store.log({
    operation: 'users.create',
    entity_type: 'user',
    entity_id: id,
    simulation_id: ids.simulationId,
    agent_id: ids.agentId,
    result: 'ok',
  });

  send(ctx.res, 201, store.record(ctx.idempotencyKey, publicUser(user)));
}

function updateUser(ctx: Ctx, id: string): void {
  const user = store.users.get(id);
  if (!user) {
    // Ojo con el orden: se responde 404 y no 422 porque un id desconocido no
    // dice nada sobre si era sintético o no.
    return fail(ctx.res, 404, 'not_found', `No existe el usuario ${id}.`);
  }

  const profile = (ctx.body.profile ?? {}) as Record<string, unknown>;
  user.profile = { ...user.profile, ...profile };
  user.updated_at = new Date().toISOString();

  store.log({
    operation: 'users.update',
    entity_type: 'user',
    entity_id: id,
    simulation_id: user.simulation_id,
    agent_id: user.agent_id,
    result: 'ok',
  });

  send(ctx.res, 200, publicUser(user));
}

function deleteUser(ctx: Ctx, id: string): void {
  if (!store.users.has(id)) {
    return fail(ctx.res, 404, 'not_found', `No existe el usuario ${id}.`);
  }
  store.users.delete(id);
  send(ctx.res, 204);
}

function createContent(ctx: Ctx): void {
  const ids = requireSimulation(ctx);
  if (!ids) return;

  const replayed = store.replay(ctx.idempotencyKey);
  if (replayed) return send(ctx.res, 201, replayed);

  const authorId = str(ctx.body, 'author_id');
  if (!store.users.has(authorId)) {
    return fail(
      ctx.res,
      422,
      'target_not_synthetic',
      `El autor ${authorId} no es un usuario sintético conocido.`,
      { author_id: authorId },
    );
  }

  const type = str(ctx.body, 'type');
  if (!MANIFEST.content_types.includes(type)) {
    return fail(
      ctx.res,
      422,
      'unprocessable',
      `Tipo de contenido "${type}" no soportado. Soportados: ${MANIFEST.content_types.join(', ')}.`,
    );
  }

  const id = `cnt_${randomUUID().slice(0, 12)}`;
  const item = {
    id,
    author_id: authorId,
    type,
    body: typeof ctx.body.body === 'string' ? ctx.body.body : null,
    parent_id: typeof ctx.body.parent_id === 'string' ? ctx.body.parent_id : null,
    attributes: (ctx.body.attributes ?? {}) as Record<string, unknown>,
    created_at:
      typeof ctx.body.created_at === 'string' ? ctx.body.created_at : new Date().toISOString(),
    ...store.marker(ids.simulationId, ids.agentId),
  };

  store.content.set(id, item);
  store.log({
    operation: 'content.create',
    entity_type: 'content',
    entity_id: id,
    simulation_id: ids.simulationId,
    agent_id: ids.agentId,
    result: 'ok',
  });

  send(ctx.res, 201, store.record(ctx.idempotencyKey, publicEntity(item)));
}

function createInteraction(ctx: Ctx): void {
  const ids = requireSimulation(ctx);
  if (!ids) return;

  const replayed = store.replay(ctx.idempotencyKey);
  if (replayed) return send(ctx.res, 201, replayed);

  const actorId = str(ctx.body, 'actor_id');
  const targetType = str(ctx.body, 'target_type');
  const targetId = str(ctx.body, 'target_id');

  if (!store.users.has(actorId)) {
    return fail(
      ctx.res,
      422,
      'target_not_synthetic',
      `El actor ${actorId} no es un usuario sintético conocido.`,
    );
  }

  // **La regla que sostiene todo el modelo de seguridad**: un agente sintético
  // no puede interactuar con una entidad real. Una app real haría esta misma
  // comprobación contra su propia base.
  if (!store.isSynthetic(targetType, targetId)) {
    store.log({
      operation: 'interactions.create',
      entity_type: targetType,
      entity_id: targetId,
      simulation_id: ids.simulationId,
      agent_id: ids.agentId,
      result: 'rejected',
    });
    return fail(
      ctx.res,
      422,
      'target_not_synthetic',
      `El objetivo ${targetId} no es una entidad sintética. Los agentes solo pueden interactuar entre ellos.`,
      { target_id: targetId, target_type: targetType },
    );
  }

  const id = `int_${randomUUID().slice(0, 12)}`;
  const interaction = {
    id,
    actor_id: actorId,
    type: str(ctx.body, 'type'),
    target_type: targetType,
    target_id: targetId,
    value: ctx.body.value ?? null,
    created_at: new Date().toISOString(),
    ...store.marker(ids.simulationId, ids.agentId),
  };

  store.interactions.set(id, interaction);
  store.log({
    operation: 'interactions.create',
    entity_type: 'interaction',
    entity_id: id,
    simulation_id: ids.simulationId,
    agent_id: ids.agentId,
    result: 'ok',
  });

  send(ctx.res, 201, store.record(ctx.idempotencyKey, publicEntity(interaction)));
}

function sendMessage(ctx: Ctx): void {
  const ids = requireSimulation(ctx);
  if (!ids) return;

  const replayed = store.replay(ctx.idempotencyKey);
  if (replayed) return send(ctx.res, 201, replayed);

  const fromId = str(ctx.body, 'from_id');
  const toIds = Array.isArray(ctx.body.to_ids) ? (ctx.body.to_ids as string[]) : [];

  if (!store.users.has(fromId)) {
    return fail(ctx.res, 422, 'target_not_synthetic', `El emisor ${fromId} no es sintético.`);
  }
  if (toIds.length === 0) {
    return fail(ctx.res, 422, 'unprocessable', 'Hace falta al menos un destinatario.');
  }
  for (const to of toIds) {
    if (!store.users.has(to)) {
      return fail(
        ctx.res,
        422,
        'target_not_synthetic',
        `El destinatario ${to} no es un usuario sintético.`,
        { target_id: to },
      );
    }
  }

  const id = `msg_${randomUUID().slice(0, 12)}`;
  const conversationId =
    typeof ctx.body.conversation_id === 'string' && ctx.body.conversation_id
      ? ctx.body.conversation_id
      : `cnv_${[fromId, ...toIds].sort().join('_').slice(0, 40)}`;

  const message = {
    id,
    conversation_id: conversationId,
    from_id: fromId,
    to_ids: toIds,
    body: str(ctx.body, 'body'),
    created_at: new Date().toISOString(),
    ...store.marker(ids.simulationId, ids.agentId),
  };

  store.messages.set(id, message);
  store.log({
    operation: 'messaging.send',
    entity_type: 'message',
    entity_id: id,
    simulation_id: ids.simulationId,
    agent_id: ids.agentId,
    result: 'ok',
  });

  send(
    ctx.res,
    201,
    store.record(ctx.idempotencyKey, {
      ...publicEntity(message),
      conversation_id: conversationId,
    }),
  );
}

function getState(ctx: Ctx): void {
  const token = store.issuePurgeToken();
  send(ctx.res, 200, {
    healthy: true,
    usi_version: USI_VERSION,
    counts: store.counts(),
    by_simulation: store.bySimulation(),
    purge_token: token.token,
    purge_token_expires_at: new Date(token.expiresAt).toISOString(),
    server_time: new Date().toISOString(),
  });
}

function purge(ctx: Ctx): void {
  const raw = str(ctx.body, 'purge_token');
  if (!raw) {
    return fail(
      ctx.res,
      403,
      'forbidden',
      'Falta purge_token. Pedí uno en GET /state: es un nonce de un solo uso, ' +
        'justamente para que un borrado masivo no pueda dispararse por accidente.',
    );
  }

  const consumed = store.consumePurgeToken(raw);
  if (!consumed.ok) {
    return fail(ctx.res, 403, 'forbidden', consumed.reason);
  }

  const scope = str(ctx.body, 'scope') || 'all';
  const dryRun = ctx.body.dry_run === true;

  if (scope === 'simulation' && !str(ctx.body, 'simulation_id')) {
    return fail(
      ctx.res,
      400,
      'invalid_request',
      'scope=simulation requiere simulation_id.',
    );
  }

  const purged = store.purge(
    scope === 'simulation' ? str(ctx.body, 'simulation_id') : undefined,
    dryRun,
  );

  send(ctx.res, 200, {
    purged,
    dry_run: dryRun,
    completed_at: new Date().toISOString(),
  });
}

function getAudit(ctx: Ctx): void {
  const simulationId = ctx.query.get('simulation_id');
  const since = ctx.query.get('since');
  const limit = Math.min(Number(ctx.query.get('limit') ?? 100) || 100, 1000);

  let events = store.audit;
  if (simulationId) events = events.filter((e) => e.simulation_id === simulationId);
  if (since) {
    const cutoff = Date.parse(since);
    if (Number.isFinite(cutoff)) {
      events = events.filter((e) => Date.parse(e.at) >= cutoff);
    }
  }

  send(ctx.res, 200, {
    events: events.slice(-limit).reverse(),
    next_cursor: null,
  });
}

// ─────────────────────────── proyección pública ───────────────────────────

/**
 * `synthetic` viaja siempre en la representación pública. Omitirlo haría que la
 * implementación **no sea conforme**: es cómo cualquier consumidor distingue un
 * agente de una persona.
 */
function publicUser(user: {
  id: string;
  profile: Record<string, unknown>;
  created_at: string;
  synthetic: true;
  simulation_id: string;
  agent_id: string;
}): Record<string, unknown> {
  return {
    id: user.id,
    synthetic: user.synthetic,
    simulation_id: user.simulation_id,
    agent_id: user.agent_id,
    created_by: 'susp',
    profile: user.profile,
    created_at: user.created_at,
  };
}

function publicEntity(entity: {
  id: string;
  created_at: string;
  synthetic: true;
  simulation_id: string;
  agent_id: string;
}): Record<string, unknown> {
  return {
    id: entity.id,
    synthetic: entity.synthetic,
    simulation_id: entity.simulation_id,
    agent_id: entity.agent_id,
    created_by: 'susp',
    created_at: entity.created_at,
  };
}

// ─────────────────────────────── enrutado ───────────────────────────────

const server = createServer((req, res) => {
  void handle(req, res).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Error no controlado:', err);
    fail(res, 500, 'internal_error', 'Error interno de la app de referencia.');
  });
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/' || path === '/health') {
    return send(res, 200, { status: 'ok', app: MANIFEST.app.name, usi_version: USI_VERSION });
  }

  if (!path.startsWith('/usi/v1')) {
    return fail(res, 404, 'not_found', 'Ruta desconocida. La API USI vive en /usi/v1.');
  }

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${TOKEN}`) {
    return fail(res, 401, 'unauthenticated', 'Token inválido o ausente.');
  }

  const body = await readBody(req, res);
  if (body === null) return;

  const ctx: Ctx = {
    req,
    res,
    body,
    query: url.searchParams,
    idempotencyKey: header(req, 'idempotency-key'),
  };

  const route = path.slice('/usi/v1'.length) || '/';
  const method = req.method ?? 'GET';

  // Rutas con parámetro
  const userMatch = /^\/users\/([^/]+)$/.exec(route);
  if (userMatch) {
    const id = decodeURIComponent(userMatch[1]);
    if (method === 'PATCH') return updateUser(ctx, id);
    if (method === 'DELETE') return deleteUser(ctx, id);
    return fail(res, 405, 'invalid_request', `Método ${method} no permitido acá.`);
  }

  const key = `${method} ${route}`;
  switch (key) {
    case 'GET /manifest':
      return getManifest(ctx);
    case 'POST /auth/verify':
      return verifyAuth(ctx);
    case 'POST /users':
      return createUser(ctx);
    case 'POST /content':
      return createContent(ctx);
    case 'POST /interactions':
      return createInteraction(ctx);
    case 'POST /messages':
      return sendMessage(ctx);
    case 'GET /state':
      return getState(ctx);
    case 'POST /purge':
      return purge(ctx);
    case 'GET /audit':
      return getAudit(ctx);
    default:
      return fail(res, 404, 'not_found', `Sin ruta para ${key}.`);
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  if (req.method === 'GET' || req.method === 'DELETE') return {};

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2_000_000) {
      fail(res, 413, 'request_too_large', 'El cuerpo supera los 2 MB.');
      return null;
    }
    chunks.push(chunk as Buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw === '') return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      fail(res, 400, 'invalid_request', 'El cuerpo tiene que ser un objeto JSON.');
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    fail(res, 400, 'invalid_request', 'El cuerpo no es JSON válido.');
    return null;
  }
}

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`App de referencia USI escuchando en http://localhost:${PORT}/usi/v1`);
  // eslint-disable-next-line no-console
  console.log(`Manifiesto: GET /usi/v1/manifest  ·  token: ${TOKEN}`);
});
