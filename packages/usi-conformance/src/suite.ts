import { randomUUID } from 'node:crypto';
import {
  formatIssues,
  USI_REQUIRED_ENDPOINTS,
  validateManifest,
  validateState,
  validateSyntheticMarker,
  type UsiCapability,
  type UsiManifest,
  type UsiState,
} from '@susp/usi-spec';
import { SuiteHttp, type UsiResponse } from './http.ts';
import type { CheckResult, SuiteOptions, SuiteReport } from './types.ts';

/**
 * Suite de conformidad de USI.
 *
 * Verifica el contrato entero contra una implementación real. No alcanza con
 * que responda 200: se comprueban las partes que son fáciles de saltear y
 * caras de descubrir tarde —el marcado sintético, el rechazo de objetivos no
 * sintéticos, la idempotencia y el nonce de purga—, porque son justamente las
 * que sostienen la seguridad del modelo.
 *
 * La suite crea datos de prueba y **los limpia al terminar**. Si se corre
 * contra una app real, no deja nada.
 */
export class ConformanceSuite {
  private readonly http: SuiteHttp;
  private readonly results: CheckResult[] = [];

  private manifest: UsiManifest | null = null;
  private createdUserIds: string[] = [];
  private createdContentId: string | null = null;

  private readonly options: SuiteOptions;

  constructor(options: SuiteOptions) {
    this.options = options;
    this.http = new SuiteHttp(
      options.baseUrl,
      options.token,
      options.timeoutMs,
      options.simulationId,
    );
  }

  async run(): Promise<SuiteReport> {
    const startedAt = Date.now();

    // El orden importa: sin manifiesto no se sabe qué probar, y sin usuarios no
    // hay con qué probar contenido ni interacciones.
    await this.checkManifest();
    await this.checkAuthRejection();
    await this.checkAuthVerify();
    await this.checkState();
    await this.checkErrorFormat();

    await this.checkUserCreation();
    await this.checkIdempotency();
    await this.checkUserUpdate();
    await this.checkContentCreation();
    await this.checkInteractionMarking();
    await this.checkNonSyntheticRejection();
    await this.checkMessaging();
    await this.checkAudit();

    await this.checkPurgeRequiresToken();
    await this.checkPurgeTokenSingleUse();
    await this.checkPurgeDryRun();

    if (!this.options.keepData) {
      await this.cleanup();
    }

    const passed = this.results.filter((r) => r.status === 'pass').length;
    const failed = this.results.filter((r) => r.status === 'fail').length;
    const skipped = this.results.filter((r) => r.status === 'skip').length;
    const warnings = this.results.filter((r) => r.status === 'warn').length;

    return {
      results: this.results,
      passed,
      failed,
      skipped,
      warnings,
      durationMs: Date.now() - startedAt,
      conformant: failed === 0,
    };
  }

  // ───────────────────────────── obligatorios ─────────────────────────────

  private async checkManifest(): Promise<void> {
    await this.check(
      'manifest.available',
      'GET /manifest responde y es válido',
      async () => {
        const response = await this.http.get<UsiManifest>('/manifest');
        if (response.status !== 200) {
          return this.fail(
            `Devolvió ${response.status}. /manifest es obligatorio y es lo primero ` +
              'que consulta el motor: sin él no puede integrarse.',
          );
        }

        const validation = validateManifest(response.body);
        if (!validation.ok) {
          return this.fail(`El manifiesto no cumple el esquema:\n${formatIssues(validation.issues)}`);
        }

        this.manifest = validation.value;
        const major = this.manifest.usi_version.split('.')[0];
        if (major !== '1') {
          return this.fail(
            `Declara USI ${this.manifest.usi_version}; esta suite valida USI 1.x.`,
          );
        }

        return this.pass(
          `USI ${this.manifest.usi_version} · ${this.manifest.app.name} · ` +
            `entorno ${this.manifest.app.environment} · ${this.manifest.capabilities.length} capacidades`,
        );
      },
    );

    // Aviso, no error: es una configuración legítima, pero conviene saberlo.
    if (this.manifest?.app.environment === 'production') {
      this.results.push({
        id: 'manifest.production',
        name: 'La app se declara en producción',
        status: 'warn',
        detail:
          'La app declara environment=production. SUSP rechazará escribir contra ' +
          'ella salvo autorización explícita, y la suite acaba de crear datos de ' +
          'prueba: revisá que se hayan purgado.',
      });
    }
  }

  private async checkAuthRejection(): Promise<void> {
    await this.check('auth.rejects', 'Rechaza un token inválido', async () => {
      const response = await this.http.post('/auth/verify', {}, { token: 'token-invalido' });
      if (response.status === 401 || response.status === 403) {
        return this.pass(`Devolvió ${response.status} ante un token inválido.`);
      }
      return this.fail(
        `Devolvió ${response.status} con un token inválido. Se espera 401 o 403: ` +
          'una API que acepta cualquier token no protege nada.',
      );
    });
  }

  private async checkAuthVerify(): Promise<void> {
    await this.check('auth.verify', 'POST /auth/verify confirma las credenciales', async () => {
      const response = await this.http.post<{ authenticated: boolean; app_id: string }>(
        '/auth/verify',
        {},
      );
      if (response.status !== 200) {
        return this.fail(`Devolvió ${response.status}. /auth/verify es obligatorio.`);
      }
      if (response.body?.authenticated !== true) {
        return this.fail('Respondió authenticated distinto de true con un token válido.');
      }
      return this.pass(`Autenticado como "${response.body.app_id}".`);
    });
  }

  private async checkState(): Promise<void> {
    await this.check('state.available', 'GET /state responde y es válido', async () => {
      const response = await this.http.get<UsiState>('/state');
      if (response.status !== 200) {
        return this.fail(`Devolvió ${response.status}. /state es obligatorio.`);
      }
      const validation = validateState(response.body);
      if (!validation.ok) {
        return this.fail(`El estado no cumple el esquema:\n${formatIssues(validation.issues)}`);
      }
      if (!response.body?.purge_token) {
        return this.fail(
          'No emite purge_token. Sin ese nonce, POST /purge no se puede invocar y ' +
            'la promesa de reversibilidad queda sin respaldo.',
        );
      }
      const counts = response.body.counts;
      return this.pass(
        `Sintéticos: ${counts.users} usuarios, ${counts.content} contenidos, ` +
          `${counts.interactions} interacciones, ${counts.messages} mensajes.`,
      );
    });
  }

  private async checkErrorFormat(): Promise<void> {
    await this.check('errors.format', 'Los errores usan el formato del estándar', async () => {
      const response = await this.http.get('/ruta-que-no-existe-' + randomUUID().slice(0, 8));
      if (response.status !== 404) {
        return this.fail(
          `Una ruta inexistente devolvió ${response.status} en vez de 404.`,
        );
      }
      const body = response.body as { error?: { code?: string; message?: string } } | null;
      if (!body?.error?.code || !body.error.message) {
        return this.fail(
          'El cuerpo del error no tiene la forma { error: { code, message } }. ' +
            'Un formato único es lo que permite al motor decidir si reintentar.',
        );
      }
      return this.pass(`404 con code="${body.error.code}".`);
    });
  }

  // ───────────────────────────── escrituras ─────────────────────────────

  private async checkUserCreation(): Promise<void> {
    await this.capabilityCheck(
      'users.create',
      'users.create',
      'Crea usuarios sintéticos y los marca',
      async () => {
        const response = await this.http.post<Record<string, unknown>>(
          '/users',
          this.userPayload('Conformidad Uno'),
          { idempotencyKey: randomUUID() },
        );

        if (response.status !== 201) {
          return this.fail(
            `Devolvió ${response.status} en vez de 201. Cuerpo: ${response.raw.slice(0, 200)}`,
          );
        }

        const marker = validateSyntheticMarker(response.body, 'usuario');
        if (!marker.ok) {
          return this.fail(
            `El usuario creado no está bien marcado:\n${formatIssues(marker.issues)}`,
          );
        }

        const id = String((response.body as { id: string }).id);
        this.createdUserIds.push(id);

        // Un segundo usuario, para poder probar interacciones y mensajería.
        const second = await this.http.post<{ id: string }>(
          '/users',
          this.userPayload('Conformidad Dos'),
          { idempotencyKey: randomUUID() },
        );
        if (second.status === 201 && second.body?.id) {
          this.createdUserIds.push(second.body.id);
        }

        return this.pass(`Usuario ${id} creado con synthetic=true, simulation_id y agent_id.`);
      },
    );
  }

  private async checkIdempotency(): Promise<void> {
    await this.capabilityCheck(
      'idempotency',
      'users.create',
      'Repetir con la misma Idempotency-Key no duplica',
      async () => {
        const key = randomUUID();
        const payload = this.userPayload('Conformidad Idempotente');

        const first = await this.http.post<{ id: string }>('/users', payload, {
          idempotencyKey: key,
        });
        if (first.status !== 201 || !first.body?.id) {
          return this.fail(`La primera petición devolvió ${first.status}.`);
        }
        this.createdUserIds.push(first.body.id);

        const second = await this.http.post<{ id: string }>('/users', payload, {
          idempotencyKey: key,
        });

        if (second.body?.id !== first.body.id) {
          return this.fail(
            `Repetir con la misma clave creó otra entidad (${first.body.id} vs ` +
              `${second.body?.id}). Sin idempotencia, cualquier reintento por timeout ` +
              'duplica datos, y el motor reintenta por diseño.',
          );
        }

        return this.pass(`Devolvió el mismo id (${first.body.id}) sin duplicar.`);
      },
    );
  }

  private async checkUserUpdate(): Promise<void> {
    await this.capabilityCheck(
      'users.update',
      'users.update',
      'Actualiza el perfil de un usuario sintético',
      async () => {
        const id = this.createdUserIds[0];
        if (!id) return this.skip('No hay usuarios creados para actualizar.');

        const response = await this.http.patch<Record<string, unknown>>(`/users/${id}`, {
          profile: { bio: 'Biografía actualizada por la suite de conformidad.' },
        });

        if (response.status !== 200) {
          return this.fail(`Devolvió ${response.status} en vez de 200.`);
        }
        const marker = validateSyntheticMarker(response.body, 'usuario actualizado');
        if (!marker.ok) {
          return this.fail(
            `La respuesta perdió el marcado sintético:\n${formatIssues(marker.issues)}`,
          );
        }
        return this.pass('Perfil actualizado, marcado conservado.');
      },
    );
  }

  private async checkContentCreation(): Promise<void> {
    await this.capabilityCheck(
      'content.create',
      'content.create',
      'Crea contenido y lo marca',
      async () => {
        const authorId = this.createdUserIds[0];
        if (!authorId) return this.skip('No hay autor sintético disponible.');

        const type = this.manifest?.content_types?.[0] ?? 'post';
        const response = await this.http.post<{ id: string }>(
          '/content',
          {
            agent_id: 'agt_conformance',
            simulation_id: this.options.simulationId,
            author_id: authorId,
            type,
            body: 'Publicación creada por la suite de conformidad de USI.',
          },
          { idempotencyKey: randomUUID() },
        );

        if (response.status !== 201) {
          return this.fail(
            `Devolvió ${response.status}. Cuerpo: ${response.raw.slice(0, 200)}`,
          );
        }
        const marker = validateSyntheticMarker(response.body, 'contenido');
        if (!marker.ok) {
          return this.fail(`El contenido no está bien marcado:\n${formatIssues(marker.issues)}`);
        }

        this.createdContentId = response.body!.id;
        return this.pass(`Contenido ${this.createdContentId} creado (tipo "${type}").`);
      },
    );
  }

  private async checkInteractionMarking(): Promise<void> {
    await this.capabilityCheck(
      'interactions.create',
      'interactions.create',
      'Registra interacciones entre entidades sintéticas',
      async () => {
        const actorId = this.createdUserIds[1] ?? this.createdUserIds[0];
        if (!actorId || !this.createdContentId) {
          return this.skip('Faltan actor o contenido sintético.');
        }

        const type = this.manifest?.interaction_types?.[0] ?? 'like';
        const response = await this.http.post<{ id: string }>(
          '/interactions',
          {
            agent_id: 'agt_conformance',
            simulation_id: this.options.simulationId,
            actor_id: actorId,
            type,
            target_type: 'content',
            target_id: this.createdContentId,
          },
          { idempotencyKey: randomUUID() },
        );

        if (response.status !== 201) {
          return this.fail(
            `Devolvió ${response.status}. Cuerpo: ${response.raw.slice(0, 200)}`,
          );
        }
        const marker = validateSyntheticMarker(response.body, 'interacción');
        if (!marker.ok) {
          return this.fail(`La interacción no está bien marcada:\n${formatIssues(marker.issues)}`);
        }
        return this.pass(`Interacción "${type}" registrada y marcada.`);
      },
    );
  }

  /**
   * El check más importante de toda la suite.
   *
   * Si una implementación deja que un agente sintético interactúe con una
   * entidad que no es sintética, deja de ser una herramienta para poblar un
   * entorno de demostración y pasa a ser una para simular actividad sobre
   * usuarios reales. No es un detalle de calidad: es la línea.
   */
  private async checkNonSyntheticRejection(): Promise<void> {
    await this.capabilityCheck(
      'interactions.rejects_real',
      'interactions.create',
      'Rechaza interactuar con una entidad NO sintética',
      async () => {
        const actorId = this.createdUserIds[0];
        if (!actorId) return this.skip('No hay actor sintético.');

        const inventado = `cnt_no_sintetico_${randomUUID().slice(0, 8)}`;
        const response = await this.http.post<{ error?: { code?: string } }>(
          '/interactions',
          {
            agent_id: 'agt_conformance',
            simulation_id: this.options.simulationId,
            actor_id: actorId,
            type: this.manifest?.interaction_types?.[0] ?? 'like',
            target_type: 'content',
            target_id: inventado,
          },
          { idempotencyKey: randomUUID() },
        );

        if (response.status === 201) {
          return this.fail(
            'Aceptó una interacción contra un objetivo que no es sintético. ' +
              'Es la falla más grave posible: permite que agentes generados actúen ' +
              'sobre contenido de usuarios reales. La app debe responder 422 con ' +
              'code="target_not_synthetic".',
          );
        }
        if (response.status !== 422 && response.status !== 404) {
          return this.fail(
            `Devolvió ${response.status}. Se espera 422 (target_not_synthetic) o 404.`,
          );
        }

        const code = response.body?.error?.code;
        if (response.status === 422 && code !== 'target_not_synthetic') {
          return this.warn(
            `Rechazó correctamente con 422, pero con code="${code}" en vez de ` +
              '"target_not_synthetic". Funciona, pero el código estándar permite ' +
              'al motor distinguir este caso de otros rechazos de negocio.',
          );
        }

        return this.pass(`Rechazado con ${response.status}${code ? ` (${code})` : ''}.`);
      },
    );
  }

  private async checkMessaging(): Promise<void> {
    await this.capabilityCheck(
      'messaging.send',
      'messaging.send',
      'Envía mensajes entre agentes sintéticos',
      async () => {
        const [from, to] = this.createdUserIds;
        if (!from || !to) return this.skip('Hacen falta dos usuarios sintéticos.');

        const response = await this.http.post<{ id: string; conversation_id?: string }>(
          '/messages',
          {
            agent_id: 'agt_conformance',
            simulation_id: this.options.simulationId,
            from_id: from,
            to_ids: [to],
            body: 'Mensaje de la suite de conformidad.',
          },
          { idempotencyKey: randomUUID() },
        );

        if (response.status !== 201) {
          return this.fail(
            `Devolvió ${response.status}. Cuerpo: ${response.raw.slice(0, 200)}`,
          );
        }
        const marker = validateSyntheticMarker(response.body, 'mensaje');
        if (!marker.ok) {
          return this.fail(`El mensaje no está bien marcado:\n${formatIssues(marker.issues)}`);
        }
        if (!response.body?.conversation_id) {
          return this.warn('No devolvió conversation_id; el motor no podrá encadenar respuestas.');
        }
        return this.pass(`Mensaje enviado en la conversación ${response.body.conversation_id}.`);
      },
    );
  }

  private async checkAudit(): Promise<void> {
    await this.capabilityCheck('audit.read', 'audit.read', 'Expone su auditoría', async () => {
      const response = await this.http.get<{ events?: unknown[] }>('/audit', {
        simulation_id: this.options.simulationId,
        limit: '10',
      });
      if (response.status !== 200) {
        return this.fail(`Devolvió ${response.status} en vez de 200.`);
      }
      if (!Array.isArray(response.body?.events)) {
        return this.fail('La respuesta no trae un array "events".');
      }
      return this.pass(`Devolvió ${response.body.events.length} evento(s).`);
    });
  }

  // ───────────────────────────── purga ─────────────────────────────

  private async checkPurgeRequiresToken(): Promise<void> {
    await this.check('purge.requires_token', 'POST /purge exige el nonce', async () => {
      const response = await this.http.post('/purge', { scope: 'all' });
      if (response.status === 200) {
        return this.fail(
          'Purgó sin purge_token. El nonce existe justamente para que un borrado ' +
            'masivo no pueda dispararse por accidente ni por una petición repetida.',
        );
      }
      if (response.status !== 403 && response.status !== 400) {
        return this.fail(`Devolvió ${response.status}. Se espera 403 (o 400).`);
      }
      return this.pass(`Rechazado con ${response.status} al faltar el nonce.`);
    });
  }

  private async checkPurgeTokenSingleUse(): Promise<void> {
    await this.check('purge.token_single_use', 'El nonce de purga es de un solo uso', async () => {
      const state = await this.http.get<UsiState>('/state');
      const token = state.body?.purge_token;
      if (!token) return this.skip('GET /state no emitió purge_token.');

      // Primera purga: en seco, para no borrar nada todavía.
      const first = await this.http.post('/purge', {
        purge_token: token,
        scope: 'simulation',
        simulation_id: this.options.simulationId,
        dry_run: true,
      });
      if (first.status !== 200) {
        return this.fail(`La purga en seco devolvió ${first.status}.`);
      }

      const second = await this.http.post('/purge', {
        purge_token: token,
        scope: 'simulation',
        simulation_id: this.options.simulationId,
        dry_run: true,
      });
      if (second.status === 200) {
        return this.fail(
          'Aceptó el mismo purge_token dos veces. Un nonce reutilizable no protege ' +
            'contra un reintento accidental, que es exactamente el riesgo que cubre.',
        );
      }
      return this.pass(`El segundo uso fue rechazado con ${second.status}.`);
    });
  }

  private async checkPurgeDryRun(): Promise<void> {
    await this.check('purge.dry_run', 'dry_run cuenta sin borrar', async () => {
      const before = await this.http.get<UsiState>('/state');
      const token = before.body?.purge_token;
      if (!token) return this.skip('GET /state no emitió purge_token.');
      const usersBefore = before.body?.counts.users ?? 0;

      const purge = await this.http.post<{ purged?: { users?: number }; dry_run?: boolean }>(
        '/purge',
        {
          purge_token: token,
          scope: 'simulation',
          simulation_id: this.options.simulationId,
          dry_run: true,
        },
      );
      if (purge.status !== 200) {
        return this.fail(`Devolvió ${purge.status}.`);
      }
      if (purge.body?.dry_run !== true) {
        return this.warn('No devolvió dry_run: true en la respuesta.');
      }

      const after = await this.http.get<UsiState>('/state');
      const usersAfter = after.body?.counts.users ?? 0;

      if (usersAfter < usersBefore) {
        return this.fail(
          `Con dry_run: true borró de verdad (${usersBefore} → ${usersAfter} usuarios). ` +
            'El modo simulacro tiene que ser inofensivo: es lo que se usa para ' +
            'estrenar una integración sin riesgo.',
        );
      }
      return this.pass(
        `Contó ${purge.body?.purged?.users ?? 0} usuario(s) sin borrar nada.`,
      );
    });
  }

  /** Borra todo lo que creó la suite. Corre siempre, salvo con `--keep-data`. */
  private async cleanup(): Promise<void> {
    await this.check('cleanup', 'La suite limpia sus propios datos', async () => {
      const state = await this.http.get<UsiState>('/state');
      const token = state.body?.purge_token;
      if (!token) {
        return this.warn(
          'No se pudo obtener un purge_token para limpiar. Revisá manualmente los ' +
            `datos de la simulación ${this.options.simulationId}.`,
        );
      }

      const response = await this.http.post<{ purged?: Record<string, number> }>('/purge', {
        purge_token: token,
        scope: 'simulation',
        simulation_id: this.options.simulationId,
        dry_run: false,
      });

      if (response.status !== 200) {
        return this.warn(
          `La limpieza devolvió ${response.status}. Quedaron datos de la simulación ` +
            `${this.options.simulationId} en la app.`,
        );
      }

      const purged = response.body?.purged ?? {};
      const total = Object.values(purged).reduce((sum, n) => sum + Number(n ?? 0), 0);
      return this.pass(`Borradas ${total} entidad(es) de prueba.`);
    });
  }

  // ───────────────────────────── infraestructura ─────────────────────────────

  private userPayload(displayName: string): Record<string, unknown> {
    const handle = `conf${randomUUID().slice(0, 8)}`;
    return {
      agent_id: 'agt_conformance',
      simulation_id: this.options.simulationId,
      profile: {
        display_name: displayName,
        handle,
        // TLD reservado (RFC 2606): imposible de entregar.
        email: `${handle}@conformance.susp.invalid`,
        locale: 'es-AR',
      },
    };
  }

  private async check(
    id: string,
    name: string,
    fn: () => Promise<Omit<CheckResult, 'id' | 'name'>>,
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      const outcome = await fn();
      this.results.push({ id, name, ...outcome, durationMs: Date.now() - startedAt });
    } catch (err) {
      this.results.push({
        id,
        name,
        status: 'fail',
        detail: `Error inesperado: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  /** Como `check`, pero se saltea si la app no declara la capacidad. */
  private async capabilityCheck(
    id: string,
    capability: UsiCapability,
    name: string,
    fn: () => Promise<Omit<CheckResult, 'id' | 'name'>>,
  ): Promise<void> {
    if (!this.manifest?.capabilities.includes(capability)) {
      this.results.push({
        id,
        name,
        capability,
        status: 'skip',
        detail: `La app no declara "${capability}".`,
      });
      return;
    }
    await this.check(id, name, async () => ({ ...(await fn()), capability }));
  }

  private pass(detail: string): Omit<CheckResult, 'id' | 'name'> {
    return { status: 'pass', detail };
  }

  private fail(detail: string): Omit<CheckResult, 'id' | 'name'> {
    return { status: 'fail', detail };
  }

  private skip(detail: string): Omit<CheckResult, 'id' | 'name'> {
    return { status: 'skip', detail };
  }

  private warn(detail: string): Omit<CheckResult, 'id' | 'name'> {
    return { status: 'warn', detail };
  }
}

/** Endpoints obligatorios, reexportados para la ayuda del CLI. */
export { USI_REQUIRED_ENDPOINTS };
export type { UsiResponse };
