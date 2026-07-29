/**
 * Idempotencia y nonces de purga respaldados en Postgres.
 *
 * Los stores en memoria del helper alcanzan para un servidor de un solo
 * proceso. **Una Edge Function no lo es**: Supabase puede tener varias
 * instancias vivas al mismo tiempo, y ahí el mapa en memoria falla de dos
 * formas silenciosas —un reintento que caiga en otra instancia duplica datos, y
 * un nonce de purga emitido en una puede reusarse en otra—. Justo las dos cosas
 * que esos mecanismos existen para impedir.
 *
 * Las tablas las crea `migracion.sql`.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { IdempotencyStore, PurgeTokenStore } from 'npm:@susp/usi-server';

export class SupabaseIdempotencyStore implements IdempotencyStore {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async get(key: string): Promise<unknown | undefined> {
    const { data } = await this.supabase
      .from('usi_idempotency')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    return data?.value ?? undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    // upsert y no insert: dos peticiones concurrentes con la misma clave no
    // deben hacer fallar a la segunda.
    await this.supabase.from('usi_idempotency').upsert({ key, value });
  }
}

export class SupabasePurgeTokenStore implements PurgeTokenStore {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async issue(ttlMs: number): Promise<{ token: string; expiresAt: number }> {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = `prg_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    const expiresAt = Date.now() + ttlMs;

    const { error } = await this.supabase.from('usi_purge_tokens').insert({
      token,
      expires_at: new Date(expiresAt).toISOString(),
    });
    if (error) throw new Error(`No se pudo emitir el purge_token: ${error.message}`);

    return { token, expiresAt };
  }

  async consume(token: string): Promise<boolean> {
    // El `eq('used', false)` dentro del propio UPDATE es lo que hace atómico el
    // consumo: si dos peticiones llegan a la vez, solo una ve la fila sin usar
    // y la otra recibe cero filas. Leer y después escribir dejaría una ventana
    // en la que ambas pasarían.
    const { data, error } = await this.supabase
      .from('usi_purge_tokens')
      .update({ used: true })
      .eq('token', token)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .select('token');

    if (error) return false;
    return (data?.length ?? 0) > 0;
  }
}
