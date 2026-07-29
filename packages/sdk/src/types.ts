/**
 * Formas que devuelve la API del motor.
 *
 * Se declaran acá y no se importan de Prisma a propósito: el SDK es un cliente
 * HTTP y no debe arrastrar el ORM del servidor. Si el motor cambia una forma,
 * se actualiza acá y quien use el SDK lo ve al compilar.
 */

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type MemberRole = 'OWNER' | 'OPERATOR' | 'VIEWER';
export type AppEnvironment = 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
export type Vertical = 'DATING' | 'SOCIAL' | 'TELEMEDICINE' | 'MARKETPLACE' | 'OTHER';
export type AppHealth =
  | 'UNKNOWN'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNREACHABLE'
  | 'NON_CONFORMANT';
export type CampaignStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
export type RunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
export type JobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'DEAD'
  | 'CANCELLED';
export type AgentStatus = 'IDLE' | 'ACTIVE' | 'EXHAUSTED' | 'DISABLED';
export type SyntheticKind = 'USER' | 'CONTENT' | 'INTERACTION' | 'MESSAGE';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  counts: {
    targetApps: number;
    campaigns: number;
    personas: number;
    scenarios: number;
  };
}

export interface ApiKeyView {
  id: string;
  name: string;
  /** Solo el prefijo: el valor en claro se muestra una única vez, al crearla. */
  prefix: string;
  role: MemberRole;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface TargetApp {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  baseUrl: string;
  env: AppEnvironment;
  vertical: Vertical;
  /** Escribir contra producción exige activarlo a mano. */
  productionWritesAllowed: boolean;
  usiVersion: string | null;
  capabilities: string[];
  requiresSignature: boolean;
  health: AppHealth;
  healthCheckedAt: string | null;
  healthDetail: string | null;
  /** Nunca incluye la credencial: solo si hay una cargada. */
  hasCredential: boolean;
  manifest: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTargetAppInput {
  name: string;
  slug: string;
  /** URL base de la API USI, por ejemplo https://mi-app.example/usi/v1 */
  baseUrl: string;
  env: AppEnvironment;
  vertical?: Vertical;
  /** Se guarda cifrado y no vuelve a salir por la API. */
  token: string;
  signingSecret?: string;
}

/** Rasgos 0..1. Lo que no se define, queda en 0,5. */
export interface Traits {
  openness?: number;
  conscientiousness?: number;
  extraversion?: number;
  agreeableness?: number;
  neuroticism?: number;
  /** Cuánto y con qué frecuencia escribe. */
  chattiness?: number;
  riskTolerance?: number;
  /** 0 = coloquial, 1 = formal. */
  formality?: number;
}

export interface Persona {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  vertical: Vertical;
  description: string | null;
  traits: Traits;
  interests: string[];
  locales: string[];
  goals: unknown[];
  schedule: Record<string, unknown>;
  rules: unknown[];
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePersonaInput {
  name: string;
  slug: string;
  vertical?: Vertical;
  description?: string;
  traits: Traits;
  interests?: string[];
  locales?: string[];
  goals?: Array<{ kind: string; target: number; weight?: number }>;
  schedule?: Record<string, unknown>;
  rules?: unknown[];
}

export interface Scenario {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  vertical: Vertical;
  description: string | null;
  /** Peso relativo por operación USI. */
  actionMix: Record<string, number>;
  intensity: number;
  seed: Record<string, unknown>;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScenarioInput {
  name: string;
  slug: string;
  vertical?: Vertical;
  description?: string;
  actionMix?: Record<string, number>;
  intensity?: number;
  seed?: Record<string, unknown>;
}

export interface Campaign {
  id: string;
  tenantId: string;
  targetAppId: string;
  scenarioId: string | null;
  name: string;
  status: CampaignStatus;
  agentCount: number;
  startsAt: string | null;
  endsAt: string | null;
  /** Calcula el plan sin ejecutar una sola escritura. */
  dryRun: boolean;
  /** 1 = tiempo real; 60 = una hora simulada por minuto real. */
  timeScale: number;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  targetApp?: Pick<TargetApp, 'id' | 'name' | 'slug' | 'env' | 'health'>;
  scenario?: Pick<Scenario, 'id' | 'name' | 'slug'> | null;
  _count?: { agents: number; runs: number };
}

export interface CreateCampaignInput {
  name: string;
  targetAppId: string;
  scenarioId?: string;
  agentCount: number;
  /** Vacío = se reparten las personas del vertical de la app. */
  personaIds?: string[];
  startsAt?: string;
  endsAt?: string;
  dryRun?: boolean;
  timeScale?: number;
  /**
   * Configuración libre. La clave que el motor entiende hoy:
   *
   * - `personaMix`: `{ [personaId]: peso }`. Reparte los agentes de forma
   *   proporcional en vez de pareja. Importa: en una red social la mayoría lee
   *   y unos pocos publican, y un reparto parejo produce un feed donde todos
   *   escriben lo mismo. Los packs de `@susp/personas` traen las proporciones.
   */
  config?: Record<string, unknown> & { personaMix?: Record<string, number> };
}

export interface Run {
  id: string;
  campaignId: string;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  jobsTotal: number;
  jobsSucceeded: number;
  jobsFailed: number;
  jobsSkipped: number;
  dryRun: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunDetail extends Run {
  jobsByStatus: Partial<Record<JobStatus, number>>;
  jobsByOperation: Array<{
    operation: string;
    count: number;
    avgDurationMs: number | null;
  }>;
  _count?: { jobs: number; entities: number };
}

export interface Job {
  id: string;
  runId: string;
  agentId: string | null;
  status: JobStatus;
  /** Operación USI: users.create, content.create, interactions.create… */
  operation: string;
  payload: Record<string, unknown>;
  priority: number;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  durationMs: number | null;
  lastError: string | null;
  createdAt: string;
}

export interface Agent {
  id: string;
  campaignId: string;
  personaId: string | null;
  status: AgentStatus;
  displayName: string;
  handle: string;
  locale: string;
  traits: Required<Traits>;
  interests: string[];
  profile: Record<string, unknown>;
  goals: Array<{ kind: string; target: number; progress: number; done: boolean }>;
  /** La misma semilla reproduce el mismo comportamiento. */
  seed: string;
  /** Id del usuario ya creado en la app destino. */
  externalUserId: string | null;
  lastActedAt: string | null;
  actionCount: number;
  errorCount: number;
  createdAt: string;
}

/** Espejo local de una entidad creada en la app destino. */
export interface SyntheticEntity {
  id: string;
  targetAppId: string;
  runId: string;
  agentId: string | null;
  kind: SyntheticKind;
  externalId: string;
  snapshot: Record<string, unknown>;
  purgedAt: string | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  runId: string | null;
  actor: string;
  operation: string;
  result: 'OK' | 'REJECTED' | 'ERROR' | 'SKIPPED' | 'DRY_RUN';
  targetAppId: string | null;
  agentId: string | null;
  entityId: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  detail: Record<string, unknown>;
  message: string | null;
  at: string;
}

export interface AuditSummaryRow {
  operation: string;
  result: string;
  count: number;
  avgDurationMs: number | null;
}

export interface PurgeCampaignResult {
  purged: Record<string, number>;
  dryRun: boolean;
  /** Entidades espejadas que siguen sin purgar. Debería quedar en 0. */
  mirroredEntities: number;
}
