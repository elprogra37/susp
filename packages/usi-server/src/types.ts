import type {
  UsiAuditEvent,
  UsiCounts,
  UsiCreateContentRequest,
  UsiCreateInteractionRequest,
  UsiCreateUserRequest,
  UsiManifest,
  UsiSendMessageRequest,
  UsiUpdateUserRequest,
} from '@susp/usi-spec';

/**
 * Lo único que tenés que implementar para que tu app sea conforme con USI.
 *
 * El helper se ocupa de lo que es fácil equivocar y caro descubrir tarde:
 * autenticación, enrutado, validación, **marcado sintético**, idempotencia,
 * nonces de purga y formato de errores. Vos escribís cómo guardar y borrar en
 * tu base, que es lo único que el helper no puede saber.
 */
export interface UsiStore {
  /**
   * Crea el usuario. **Guardá el marcador** que viene en `marker`: la app tiene
   * que poder devolverlo después y filtrar por él.
   */
  createUser(input: UsiCreateUserRequest, marker: StoredMarker): Promise<{ id: string; external_ref?: string }>;

  updateUser?(id: string, input: UsiUpdateUserRequest): Promise<{ id: string } | null>;

  deleteUser?(id: string): Promise<boolean>;

  createContent?(
    input: UsiCreateContentRequest,
    marker: StoredMarker,
  ): Promise<{ id: string }>;

  createInteraction?(
    input: UsiCreateInteractionRequest,
    marker: StoredMarker,
  ): Promise<{ id: string }>;

  sendMessage?(
    input: UsiSendMessageRequest,
    marker: StoredMarker,
  ): Promise<{ id: string; conversation_id: string }>;

  /**
   * Devuelve el marcado de una entidad, o `null` si no es sintética.
   *
   * **Es la función más importante de toda la integración.** El helper la usa
   * para dos cosas: rechazar cualquier intento de que un agente interactúe con
   * contenido o usuarios reales, y poder devolver el marcado en las respuestas
   * de actualización. Ante la duda, devolvé `null`: un falso negativo cuesta
   * una acción omitida; un falso positivo permite que un agente generado actúe
   * sobre datos de una persona.
   *
   * Una sola pregunta responde las dos cosas, así que no hay forma de que un
   * `isSynthetic` y un `getMarker` se contradigan.
   */
  getMarker(targetType: string, id: string): Promise<StoredMarker | null>;

  /** Contadores **solo de entidades sintéticas**. */
  counts(simulationId?: string): Promise<UsiCounts>;

  /**
   * Borra entidades sintéticas. Si viene `simulationId`, solo las de esa
   * ejecución. **Nunca debe alcanzar datos reales**: filtrá siempre por el
   * marcador, no por fecha ni por rango de ids.
   */
  purge(simulationId: string | undefined, dryRun: boolean): Promise<UsiCounts>;

  /** Opcional: histórico de operaciones aplicadas. */
  audit?(params: {
    simulationId?: string;
    since?: string;
    limit: number;
    cursor?: string;
  }): Promise<{ events: UsiAuditEvent[]; next_cursor: string | null }>;

  /** Opcional: agrupado por ejecución, para `GET /state`. */
  bySimulation?(): Promise<Array<{ simulation_id: string; [key: string]: unknown }>>;
}

/** Marcado que el helper arma y tu store debe persistir tal cual. */
export interface StoredMarker {
  synthetic: true;
  simulation_id: string;
  agent_id: string;
  created_by: 'susp';
}

export interface UsiHandlerConfig {
  /** Token bearer que la app espera. Se compara en tiempo constante. */
  token: string;

  /** Manifiesto. Las capacidades declaradas deben coincidir con lo implementado. */
  manifest: UsiManifest;

  store: UsiStore;

  /** Prefijo de las rutas. Por defecto `/usi/v1`. */
  basePath?: string;

  /**
   * Vida del nonce de purga, en milisegundos. Por defecto 15 minutos.
   * Corto a propósito: es un permiso para borrar en masa.
   */
  purgeTokenTtlMs?: number;

  /**
   * Guarda el resultado de una clave de idempotencia. Sin esto, el helper usa
   * un mapa en memoria, que alcanza para un proceso único pero **no** para una
   * función serverless con varias instancias: ahí conviene una tabla.
   */
  idempotencyStore?: IdempotencyStore;

  /** Emisión/consumo de nonces de purga. Mismo criterio que la idempotencia. */
  purgeTokenStore?: PurgeTokenStore;

  /** Hook para registrar cada operación aplicada. */
  onOperation?: (event: {
    operation: string;
    entityType: string;
    entityId: string;
    simulationId: string;
    agentId?: string;
    result: 'ok' | 'rejected';
  }) => void | Promise<void>;
}

export interface IdempotencyStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface PurgeTokenStore {
  issue(ttlMs: number): Promise<{ token: string; expiresAt: number }>;
  /** Debe devolver `false` si el token no existe, venció o ya se usó. */
  consume(token: string): Promise<boolean>;
}
