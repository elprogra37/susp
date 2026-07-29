/**
 * Plantilla de USI para una app Flutter + Supabase.
 *
 * Se despliega como Edge Function (Deno):
 *
 *   supabase functions deploy usi --no-verify-jwt
 *   supabase secrets set USI_TOKEN="$(openssl rand -hex 32)"
 *
 * `--no-verify-jwt` es correcto acá: USI trae su propia autenticación por token
 * bearer, que es lo que el motor sabe usar. La función no debe exigir además un
 * JWT de Supabase.
 *
 * Después se registra en SUSP con esa URL y ese token, y se valida:
 *
 *   npx @susp/usi-conformance \
 *     --url https://<proyecto>.supabase.co/functions/v1/usi/usi/v1 \
 *     --token <USI_TOKEN>
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Antes de usarla, hay que hacer dos cosas en la base (ver `migracion.sql`):
 *
 *   1. Agregar a cada tabla poblable las columnas del marcado sintético.
 *   2. Excluir lo sintético de las vistas y métricas de negocio.
 *
 * El segundo punto es el que se olvida y el que más duele: si los usuarios
 * sintéticos entran en los reportes, los números dejan de significar nada.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createUsiHandler } from 'npm:@susp/usi-server';
import type { StoredMarker, UsiStore } from 'npm:@susp/usi-server';

const USI_TOKEN = Deno.env.get('USI_TOKEN');
if (!USI_TOKEN) {
  throw new Error('Falta el secreto USI_TOKEN. supabase secrets set USI_TOKEN=...');
}

// La service role key saltea RLS, que es lo que hace falta para poder insertar
// usuarios sintéticos. Nunca sale de la función.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

/**
 * El store traduce las operaciones de USI a tu esquema.
 *
 * Todo lo demás —autenticación, validación, marcado, rechazo de objetivos no
 * sintéticos, idempotencia, nonces de purga, formato de errores— lo pone el
 * helper. Acá solo se escribe SQL.
 */
const store: UsiStore = {
  async createUser(input, marker: StoredMarker) {
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        display_name: input.profile.display_name,
        handle: input.profile.handle,
        email: input.profile.email,
        bio: input.profile.bio ?? null,
        birth_date: input.profile.birth_date ?? null,
        city: input.profile.location?.city ?? null,
        interests: input.profile.interests ?? [],
        avatar_seed: input.profile.avatar?.seed ?? null,
        locale: input.profile.locale ?? 'es-AR',
        // El marcado se guarda tal cual: es lo que hace posible filtrarlo y purgarlo.
        ...marker,
      })
      .select('id')
      .single();

    if (error) throw new Error(`No se pudo crear el perfil: ${error.message}`);
    return { id: data.id };
  },

  async updateUser(id, input) {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...(input.profile.display_name ? { display_name: input.profile.display_name } : {}),
        ...(input.profile.bio !== undefined ? { bio: input.profile.bio } : {}),
        updated_at: new Date().toISOString(),
      })
      // El filtro por `synthetic` no es decorativo: sin él, un id equivocado
      // podría editar el perfil de una persona real.
      .eq('id', id)
      .eq('synthetic', true)
      .select('id')
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ? { id: data.id } : null;
  },

  async deleteUser(id) {
    const { error, count } = await supabase
      .from('profiles')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('synthetic', true);

    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  },

  async createContent(input, marker) {
    const { data, error } = await supabase
      .from('posts')
      .insert({
        author_id: input.author_id,
        type: input.type,
        body: input.body ?? null,
        parent_id: input.parent_id ?? null,
        created_at: input.created_at ?? new Date().toISOString(),
        ...marker,
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);
    return { id: data.id };
  },

  async createInteraction(input, marker) {
    const { data, error } = await supabase
      .from('reactions')
      .insert({
        actor_id: input.actor_id,
        type: input.type,
        target_type: input.target_type,
        target_id: input.target_id,
        value: input.value ?? null,
        ...marker,
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);
    return { id: data.id };
  },

  async sendMessage(input, marker) {
    const conversationId =
      input.conversation_id ?? crypto.randomUUID();

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        from_id: input.from_id,
        to_ids: input.to_ids,
        body: input.body,
        ...marker,
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);
    return { id: data.id, conversation_id: conversationId };
  },

  /**
   * **La función más importante de la integración.**
   *
   * El helper la usa para dos cosas: rechazar cualquier intento de que un agente
   * interactúe con contenido o usuarios reales, y devolver el marcado en las
   * respuestas de actualización. Ante la duda, devolvé `null`: un falso negativo
   * cuesta una acción omitida; un falso positivo permite que un agente generado
   * actúe sobre datos de una persona.
   */
  async getMarker(targetType, id) {
    const tabla =
      targetType === 'user' ? 'profiles' : targetType === 'content' ? 'posts' : 'reactions';

    const { data, error } = await supabase
      .from(tabla)
      .select('synthetic, simulation_id, agent_id')
      .eq('id', id)
      .maybeSingle();

    if (error || data?.synthetic !== true) return null;
    return {
      synthetic: true,
      simulation_id: data.simulation_id,
      agent_id: data.agent_id,
      created_by: 'susp',
    };
  },

  async counts(simulationId) {
    const contar = async (tabla: string): Promise<number> => {
      let query = supabase
        .from(tabla)
        .select('id', { count: 'exact', head: true })
        .eq('synthetic', true);
      if (simulationId) query = query.eq('simulation_id', simulationId);
      const { count } = await query;
      return count ?? 0;
    };

    const [users, content, interactions, messages] = await Promise.all([
      contar('profiles'),
      contar('posts'),
      contar('reactions'),
      contar('messages'),
    ]);

    return { users, content, interactions, messages };
  },

  /**
   * Borra solo lo sintético. **Siempre filtrando por `synthetic = true`**, nunca
   * por rango de fechas ni de ids: esa es la diferencia entre limpiar una demo y
   * borrarle datos a un cliente.
   */
  async purge(simulationId, dryRun) {
    const previos = await store.counts(simulationId);
    if (dryRun) return previos;

    // El orden importa: primero lo que referencia, después lo referenciado.
    for (const tabla of ['reactions', 'messages', 'posts', 'profiles']) {
      let query = supabase.from(tabla).delete().eq('synthetic', true);
      if (simulationId) query = query.eq('simulation_id', simulationId);
      const { error } = await query;
      if (error) throw new Error(`Falló la purga de ${tabla}: ${error.message}`);
    }

    return previos;
  },

  async audit({ simulationId, since, limit }) {
    let query = supabase
      .from('usi_audit')
      .select('*')
      .order('at', { ascending: false })
      .limit(limit);

    if (simulationId) query = query.eq('simulation_id', simulationId);
    if (since) query = query.gte('at', since);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return { events: data ?? [], next_cursor: null };
  },
};

const handler = createUsiHandler({
  token: USI_TOKEN,
  manifest: {
    usi_version: '1.0.0',
    app: {
      name: Deno.env.get('USI_APP_NAME') ?? 'mi-app',
      // Cambiar a 'production' cuando corresponda. SUSP se niega a escribir
      // contra una app en producción salvo autorización explícita — la etiqueta
      // no es cosmética.
      environment: (Deno.env.get('USI_ENV') ?? 'development') as 'development',
      vertical: 'social',
    },
    // Declarar solo lo que el store implementa: el helper valida esto al
    // construirse y falla temprano si no coinciden.
    capabilities: [
      'users.create',
      'users.update',
      'users.delete',
      'content.create',
      'interactions.create',
      'messaging.send',
      'audit.read',
    ],
    content_types: ['post', 'comment', 'photo'],
    interaction_types: ['like', 'follow', 'share', 'comment'],
    limits: { requests_per_minute: 600 },
  },
  store,
  async onOperation(event) {
    // Auditoría del lado de la app: qué se aplicó realmente, no qué se pidió.
    await supabase.from('usi_audit').insert({
      operation: event.operation,
      entity_type: event.entityType,
      entity_id: event.entityId,
      simulation_id: event.simulationId,
      agent_id: event.agentId ?? null,
      result: event.result,
    });
  },
});

// Nota sobre idempotencia y nonces de purga: por defecto viven en memoria, y
// una Edge Function puede tener varias instancias. Para producción conviene
// respaldarlos en una tabla — ver `migracion.sql`, que crea `usi_idempotency` y
// `usi_purge_tokens`, y `stores-supabase.ts` con las dos implementaciones.
Deno.serve(handler);
