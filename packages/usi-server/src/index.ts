/**
 * `@susp/usi-server` — implementá USI en tu app con lo mínimo indispensable.
 *
 * El helper se queda con las partes del contrato que son fáciles de equivocar y
 * caras de descubrir tarde: autenticación, enrutado, validación, **marcado
 * sintético**, rechazo de objetivos no sintéticos, idempotencia, nonces de purga
 * y formato de errores. Vos escribís cómo guardar y cómo borrar en tu base.
 *
 * Devuelve un handler `(Request) => Promise<Response>` con la firma estándar de
 * la Web: corre tal cual en una Supabase Edge Function (Deno), en Cloudflare
 * Workers, en Bun, o detrás de un adaptador en Node.
 *
 * Sin dependencias fuera de `@susp/usi-spec`, que tampoco tiene ninguna.
 */

export { createUsiHandler } from './handler.ts';
export { MemoryIdempotencyStore, MemoryPurgeTokenStore, randomToken } from './stores.ts';
export type {
  IdempotencyStore,
  PurgeTokenStore,
  StoredMarker,
  UsiHandlerConfig,
  UsiStore,
} from './types.ts';
