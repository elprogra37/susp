/**
 * Configuración tipada del motor.
 *
 * Se valida al arrancar: si falta algo esencial o hay una combinación insegura,
 * el proceso no levanta. Es preferible fallar en el arranque que descubrir a
 * mitad de una campaña que el motor está escribiendo contra producción.
 */

export type LlmProviderName = 'anthropic' | 'deterministic';

export interface SuspConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly logLevel: string;

  readonly databaseUrl: string;
  readonly jwtSecret: string;
  /** Clave de cifrado de credenciales USI en reposo (32 bytes, hex o base64). */
  readonly encryptionKey: string;

  readonly llm: {
    readonly provider: LlmProviderName;
    readonly anthropicApiKey?: string;
    readonly reasoningModel: string;
    readonly contentModel: string;
  };

  readonly safety: {
    /** Si es true, el motor rechaza escribir contra apps marcadas como producción. */
    readonly blockProductionTargets: boolean;
    /** Modo simulación global: calcula el plan sin ejecutar escrituras. */
    readonly dryRun: boolean;
  };

  readonly scheduler: {
    readonly enabled: boolean;
    readonly pollMs: number;
    readonly batchSize: number;
  };

  readonly usi: {
    readonly timeoutMs: number;
    readonly maxRetries: number;
    /** Fallos consecutivos antes de abrir el circuito de una app. */
    readonly circuitBreakerThreshold: number;
    readonly circuitBreakerResetMs: number;
  };
}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `Falta la variable de entorno obligatoria ${name}. Ver .env.example.`,
    );
  }
  return value;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SuspConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as SuspConfig['nodeEnv'];
  const provider = (env.SUSP_LLM_PROVIDER ?? 'deterministic') as LlmProviderName;

  if (provider !== 'anthropic' && provider !== 'deterministic') {
    throw new Error(
      `SUSP_LLM_PROVIDER debe ser "anthropic" o "deterministic", no "${provider}".`,
    );
  }

  if (provider === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    throw new Error(
      'SUSP_LLM_PROVIDER=anthropic requiere ANTHROPIC_API_KEY. ' +
        'Para desarrollo y tests usá SUSP_LLM_PROVIDER=deterministic, que no necesita clave.',
    );
  }

  const jwtSecret = required('JWT_SECRET', env.JWT_SECRET);
  if (nodeEnv === 'production' && jwtSecret.length < 32) {
    throw new Error('En producción JWT_SECRET debe tener al menos 32 caracteres.');
  }

  // Si no se define clave de cifrado, se deriva del JWT_SECRET. Es aceptable en
  // desarrollo; en producción se exige una propia para poder rotarlas por separado.
  const encryptionKey = env.SUSP_ENCRYPTION_KEY ?? jwtSecret;
  if (nodeEnv === 'production' && !env.SUSP_ENCRYPTION_KEY) {
    throw new Error(
      'En producción SUSP_ENCRYPTION_KEY es obligatoria y debe ser distinta de JWT_SECRET.',
    );
  }

  return {
    nodeEnv,
    port: int(env.SUSP_API_PORT, 55701),
    logLevel: env.LOG_LEVEL ?? 'info',

    databaseUrl: required('DATABASE_URL', env.DATABASE_URL),
    jwtSecret,
    encryptionKey,

    llm: {
      provider,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      reasoningModel: env.SUSP_LLM_MODEL_REASONING ?? 'claude-opus-5',
      contentModel: env.SUSP_LLM_MODEL_CONTENT ?? 'claude-haiku-4-5',
    },

    safety: {
      blockProductionTargets: bool(env.SUSP_BLOCK_PRODUCTION_TARGETS, true),
      dryRun: bool(env.SUSP_DRY_RUN, false),
    },

    scheduler: {
      enabled: bool(env.SUSP_SCHEDULER_ENABLED, true),
      pollMs: int(env.SUSP_SCHEDULER_POLL_MS, 2000),
      batchSize: int(env.SUSP_SCHEDULER_BATCH_SIZE, 10),
    },

    usi: {
      timeoutMs: int(env.SUSP_USI_TIMEOUT_MS, 15000),
      maxRetries: int(env.SUSP_USI_MAX_RETRIES, 3),
      circuitBreakerThreshold: int(env.SUSP_USI_CB_THRESHOLD, 5),
      circuitBreakerResetMs: int(env.SUSP_USI_CB_RESET_MS, 30000),
    },
  };
}

export const CONFIG = Symbol('SUSP_CONFIG');
