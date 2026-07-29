/**
 * `@susp/usi-spec` — la fuente de verdad del contrato USI.
 *
 * Lo consumen el motor, el SDK, el helper de servidor y la suite de
 * conformidad. Si el contrato cambia, cambia acá y los cuatro se enteran al
 * compilar en vez de descubrirlo en producción.
 *
 * Sin dependencias: los validadores están escritos a mano para que este paquete
 * se pueda usar tal cual en una Supabase Edge Function (Deno).
 */

export * from './types.ts';
export * from './validate.ts';
export { openapi, type OpenApiDocument } from './openapi.ts';
