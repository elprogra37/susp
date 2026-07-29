import type { IdempotencyStore, PurgeTokenStore } from './types.ts';

/**
 * Implementaciones en memoria de la idempotencia y los nonces de purga.
 *
 * Son las que se usan por defecto y alcanzan para un servidor de un solo
 * proceso. **No alcanzan para una función serverless con varias instancias**:
 * cada instancia tendría su propio mapa, así que un reintento que caiga en otra
 * instancia duplicaría datos, y un nonce emitido en una podría reusarse en
 * otra. En ese caso hay que pasar implementaciones respaldadas por una tabla —
 * el helper avisa por consola cuando detecta ese escenario.
 */

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, { value: unknown; at: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs = 24 * 60 * 60_000, maxEntries = 10_000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  async get(key: string): Promise<unknown | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: unknown): Promise<void> {
    // Corte por tamaño: sin esto, una simulación larga hace crecer el mapa
    // hasta quedarse sin memoria.
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, at: Date.now() });
  }
}

export class MemoryPurgeTokenStore implements PurgeTokenStore {
  private readonly tokens = new Map<string, { expiresAt: number; used: boolean }>();

  async issue(ttlMs: number): Promise<{ token: string; expiresAt: number }> {
    this.cleanup();
    const token = `prg_${randomToken()}`;
    const expiresAt = Date.now() + ttlMs;
    this.tokens.set(token, { expiresAt, used: false });
    return { token, expiresAt };
  }

  async consume(token: string): Promise<boolean> {
    const entry = this.tokens.get(token);
    if (!entry || entry.used || entry.expiresAt < Date.now()) return false;
    entry.used = true;
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.tokens) {
      if (entry.used || entry.expiresAt < now) this.tokens.delete(key);
    }
  }
}

/**
 * Token aleatorio con `crypto.getRandomValues`, que existe tanto en Node 18+
 * como en Deno y en los runtimes de borde. `Math.random()` no serviría: esto
 * autoriza un borrado masivo y tiene que ser impredecible.
 */
function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export { randomToken };
