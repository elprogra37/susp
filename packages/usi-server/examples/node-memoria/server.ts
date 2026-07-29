/**
 * Ejemplo mínimo: USI conforme en ~120 líneas, usando el helper.
 *
 *   node examples/node-memoria/server.ts
 *   npx @susp/usi-conformance --url http://localhost:55705/usi/v1 --token demo
 *
 * Todo lo delicado del contrato —marcado sintético, rechazo de objetivos no
 * sintéticos, nonces de purga, idempotencia, formato de errores— lo pone el
 * helper. Acá solo se guarda y se borra.
 *
 * Sirve de doble propósito: es documentación ejecutable, y es la prueba de que
 * el helper produce implementaciones conformes.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createUsiHandler } from '../../src/index.ts';
import type { StoredMarker, UsiStore } from '../../src/index.ts';

const PORT = Number(process.env.PORT ?? 55705);
const TOKEN = process.env.USI_TOKEN ?? 'demo';

interface Fila extends StoredMarker {
  id: string;
  [key: string]: unknown;
}

const tablas: Record<string, Map<string, Fila>> = {
  users: new Map(),
  content: new Map(),
  interactions: new Map(),
  messages: new Map(),
};

function insertar(tabla: string, marker: StoredMarker, extra: Record<string, unknown>): string {
  const id = `${tabla.slice(0, 3)}_${randomUUID().slice(0, 12)}`;
  tablas[tabla].set(id, { id, ...marker, ...extra });
  return id;
}

function contar(tabla: string, simulationId?: string): number {
  const filas = [...tablas[tabla].values()];
  return simulationId
    ? filas.filter((f) => f.simulation_id === simulationId).length
    : filas.length;
}

const store: UsiStore = {
  async createUser(input, marker) {
    return { id: insertar('users', marker, { profile: input.profile }) };
  },

  async updateUser(id, input) {
    const fila = tablas.users.get(id);
    if (!fila) return null;
    fila.profile = { ...(fila.profile as object), ...input.profile };
    return { id };
  },

  async deleteUser(id) {
    return tablas.users.delete(id);
  },

  async createContent(input, marker) {
    return {
      id: insertar('content', marker, {
        author_id: input.author_id,
        type: input.type,
        body: input.body ?? null,
      }),
    };
  },

  async createInteraction(input, marker) {
    return {
      id: insertar('interactions', marker, {
        actor_id: input.actor_id,
        type: input.type,
        target_id: input.target_id,
      }),
    };
  },

  async sendMessage(input, marker) {
    const conversationId = input.conversation_id ?? `cnv_${randomUUID().slice(0, 12)}`;
    return {
      id: insertar('messages', marker, {
        conversation_id: conversationId,
        from_id: input.from_id,
        to_ids: input.to_ids,
        body: input.body,
      }),
      conversation_id: conversationId,
    };
  },

  /**
   * En un almacén donde *todo* es sintético, alcanza con que la entidad exista.
   * En una app real esto lee las columnas del marcado de tu base — y ante la
   * duda tiene que devolver `null`.
   */
  async getMarker(targetType, id) {
    const tabla =
      targetType === 'user' ? 'users' : targetType === 'content' ? 'content' : 'interactions';
    const fila = tablas[tabla].get(id);
    if (!fila) return null;
    return {
      synthetic: true,
      simulation_id: fila.simulation_id,
      agent_id: fila.agent_id,
      created_by: 'susp',
    };
  },

  async counts(simulationId) {
    return {
      users: contar('users', simulationId),
      content: contar('content', simulationId),
      interactions: contar('interactions', simulationId),
      messages: contar('messages', simulationId),
    };
  },

  async purge(simulationId, dryRun) {
    const previos = await store.counts(simulationId);
    if (dryRun) return previos;

    for (const tabla of Object.values(tablas)) {
      for (const [id, fila] of tabla) {
        if (!simulationId || fila.simulation_id === simulationId) tabla.delete(id);
      }
    }
    return previos;
  },

  async audit({ simulationId, limit }) {
    const eventos = auditoría
      .filter((e) => !simulationId || e.simulation_id === simulationId)
      .slice(-limit)
      .reverse();
    return { events: eventos, next_cursor: null };
  },
};

const auditoría: Array<{
  id: string;
  at: string;
  operation: string;
  entity_type: string;
  entity_id: string;
  simulation_id: string;
  agent_id?: string;
  result: string;
}> = [];

const handler = createUsiHandler({
  token: TOKEN,
  manifest: {
    usi_version: '1.0.0',
    app: { name: 'ejemplo-node-memoria', environment: 'development', vertical: 'social' },
    capabilities: [
      'users.create',
      'users.update',
      'users.delete',
      'content.create',
      'interactions.create',
      'messaging.send',
      'audit.read',
    ],
    content_types: ['post', 'comment'],
    interaction_types: ['like', 'follow'],
  },
  store,
  onOperation(event) {
    auditoría.push({
      id: `aud_${randomUUID().slice(0, 12)}`,
      at: new Date().toISOString(),
      operation: event.operation,
      entity_type: event.entityType,
      entity_id: event.entityId,
      simulation_id: event.simulationId,
      agent_id: event.agentId,
      result: event.result,
    });
  },
});

/**
 * Adaptador de `node:http` a la firma estándar `(Request) => Response`.
 * En Deno, Bun o Workers no hace falta: se pasa el handler directo.
 */
createServer((req, res) => {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
  const chunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });

    void handler(request).then(async (response) => {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
    });
  });
}).listen(PORT, () => {
  console.log(`USI de ejemplo escuchando en http://localhost:${PORT}/usi/v1  ·  token: ${TOKEN}`);
});
