import { randomUUID } from 'node:crypto';

/**
 * Almacén en memoria de la app de referencia.
 *
 * Modela lo mínimo que necesita una app para ser conforme con USI, con una
 * regla que atraviesa todo: **cada entidad guarda su marcado sintético**, y
 * nada puede crearse sin él. Es la parte del contrato que una implementación
 * real no puede saltearse, así que la referencia tampoco.
 */

export interface SyntheticMarker {
  synthetic: true;
  simulation_id: string;
  agent_id: string;
  created_by: 'susp';
}

export interface StoredUser extends SyntheticMarker {
  id: string;
  profile: Record<string, unknown>;
  attributes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StoredContent extends SyntheticMarker {
  id: string;
  author_id: string;
  type: string;
  body: string | null;
  parent_id: string | null;
  attributes: Record<string, unknown>;
  created_at: string;
}

export interface StoredInteraction extends SyntheticMarker {
  id: string;
  actor_id: string;
  type: string;
  target_type: string;
  target_id: string;
  value: unknown;
  created_at: string;
}

export interface StoredMessage extends SyntheticMarker {
  id: string;
  conversation_id: string;
  from_id: string;
  to_ids: string[];
  body: string;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  operation: string;
  entity_type: string;
  entity_id: string;
  simulation_id: string;
  agent_id?: string;
  result: 'ok' | 'rejected';
}

export interface PurgeToken {
  token: string;
  expiresAt: number;
  used: boolean;
}

export class Store {
  readonly users = new Map<string, StoredUser>();
  readonly content = new Map<string, StoredContent>();
  readonly interactions = new Map<string, StoredInteraction>();
  readonly messages = new Map<string, StoredMessage>();
  readonly audit: AuditEntry[] = [];

  /** Resultados ya devueltos por clave de idempotencia. */
  private readonly idempotency = new Map<string, unknown>();

  private readonly purgeTokens = new Map<string, PurgeToken>();

  // ─────────────────────────────── idempotencia ───────────────────────────────

  /**
   * Devuelve el resultado guardado para una clave, si existe.
   * Repetir una petición con la misma clave tiene que devolver lo mismo sin
   * duplicar nada: es parte del contrato de USI y lo que hace seguro reintentar.
   */
  replay<T>(key: string | undefined): T | undefined {
    if (!key) return undefined;
    return this.idempotency.get(key) as T | undefined;
  }

  record<T>(key: string | undefined, value: T): T {
    if (key) this.idempotency.set(key, value);
    return value;
  }

  // ─────────────────────────────── marcado ───────────────────────────────

  marker(simulationId: string, agentId: string): SyntheticMarker {
    return {
      synthetic: true,
      simulation_id: simulationId,
      agent_id: agentId,
      created_by: 'susp',
    };
  }

  /**
   * ¿Este id corresponde a una entidad sintética conocida?
   *
   * Es la comprobación que impide que un agente interactúe con un usuario real.
   * Una implementación real consultaría su propia base; acá alcanza con mirar
   * los mapas, porque todo lo que hay es sintético por definición.
   */
  isSynthetic(targetType: string, id: string): boolean {
    switch (targetType) {
      case 'user':
        return this.users.has(id);
      case 'content':
        return this.content.has(id);
      case 'interaction':
        return this.interactions.has(id);
      default:
        return false;
    }
  }

  // ─────────────────────────────── purga ───────────────────────────────

  /** Emite un nonce de un solo uso con 15 minutos de vida. */
  issuePurgeToken(): PurgeToken {
    const token: PurgeToken = {
      token: `prg_${randomUUID().replace(/-/g, '')}`,
      expiresAt: Date.now() + 15 * 60_000,
      used: false,
    };
    this.purgeTokens.set(token.token, token);
    this.cleanupTokens();
    return token;
  }

  consumePurgeToken(raw: string): { ok: true } | { ok: false; reason: string } {
    const token = this.purgeTokens.get(raw);
    if (!token) return { ok: false, reason: 'El purge_token no existe.' };
    if (token.used) return { ok: false, reason: 'El purge_token ya fue usado.' };
    if (token.expiresAt < Date.now()) {
      return { ok: false, reason: 'El purge_token venció. Pedí uno nuevo en GET /state.' };
    }
    token.used = true;
    return { ok: true };
  }

  private cleanupTokens(): void {
    const now = Date.now();
    for (const [key, token] of this.purgeTokens) {
      if (token.used || token.expiresAt < now) this.purgeTokens.delete(key);
    }
  }

  /**
   * Borra lo sintético. `simulationId` acota a una ejecución concreta.
   * **Solo toca lo que está en estos mapas**, que es sintético por construcción:
   * ninguna variante de esta llamada puede alcanzar un dato real.
   */
  purge(
    simulationId: string | undefined,
    dryRun: boolean,
  ): { users: number; content: number; interactions: number; messages: number } {
    const matches = (marker: SyntheticMarker): boolean =>
      simulationId === undefined || marker.simulation_id === simulationId;

    const counts = {
      users: [...this.users.values()].filter(matches).length,
      content: [...this.content.values()].filter(matches).length,
      interactions: [...this.interactions.values()].filter(matches).length,
      messages: [...this.messages.values()].filter(matches).length,
    };

    if (!dryRun) {
      this.deleteMatching(this.users, matches);
      this.deleteMatching(this.content, matches);
      this.deleteMatching(this.interactions, matches);
      this.deleteMatching(this.messages, matches);
    }

    return counts;
  }

  private deleteMatching<T extends SyntheticMarker>(
    map: Map<string, T>,
    predicate: (item: T) => boolean,
  ): void {
    for (const [key, value] of map) {
      if (predicate(value)) map.delete(key);
    }
  }

  // ─────────────────────────────── auditoría ───────────────────────────────

  log(entry: Omit<AuditEntry, 'id' | 'at'>): void {
    this.audit.push({
      id: `aud_${randomUUID().slice(0, 12)}`,
      at: new Date().toISOString(),
      ...entry,
    });
    // Es una app de referencia en memoria: se acota el historial para no crecer
    // sin límite en una simulación larga.
    if (this.audit.length > 5000) this.audit.splice(0, this.audit.length - 5000);
  }

  counts(): { users: number; content: number; interactions: number; messages: number } {
    return {
      users: this.users.size,
      content: this.content.size,
      interactions: this.interactions.size,
      messages: this.messages.size,
    };
  }

  bySimulation(): Array<{ simulation_id: string; users: number; content: number }> {
    const grouped = new Map<string, { users: number; content: number }>();

    const bump = (id: string, key: 'users' | 'content'): void => {
      const entry = grouped.get(id) ?? { users: 0, content: 0 };
      entry[key] += 1;
      grouped.set(id, entry);
    };

    for (const user of this.users.values()) bump(user.simulation_id, 'users');
    for (const item of this.content.values()) bump(item.simulation_id, 'content');

    return [...grouped.entries()].map(([simulation_id, value]) => ({
      simulation_id,
      ...value,
    }));
  }
}
