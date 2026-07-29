/**
 * Tipos del estándar USI v1.
 *
 * Este paquete es la **fuente de verdad del contrato**: lo usan el motor, el SDK
 * y la suite de conformidad. Si el contrato cambia, cambia acá y los tres se
 * enteran al compilar, en vez de descubrirlo en producción.
 */

export const USI_VERSION = '1.0.0';
export const USI_BASE_PATH = '/usi/v1';

export const USI_CAPABILITIES = [
  'users.create',
  'users.update',
  'users.delete',
  'content.create',
  'interactions.create',
  'messaging.send',
  'audit.read',
] as const;

export type UsiCapability = (typeof USI_CAPABILITIES)[number];

/** Endpoints obligatorios: sin estos cuatro, una implementación no es conforme. */
export const USI_REQUIRED_ENDPOINTS = [
  { method: 'GET', path: '/manifest' },
  { method: 'POST', path: '/auth/verify' },
  { method: 'GET', path: '/state' },
  { method: 'POST', path: '/purge' },
] as const;

export type UsiEnvironment = 'development' | 'staging' | 'production';

export type UsiVertical =
  | 'dating'
  | 'social'
  | 'telemedicine'
  | 'marketplace'
  | 'other';

// ─────────────────────────────── marcado ───────────────────────────────

/**
 * Marcado sintético. **Obligatorio en toda entidad creada vía USI**, sin
 * excepción y sin opción de desactivarlo: es lo que separa poblar un entorno de
 * demostración de simular actividad falsa.
 */
export interface UsiSyntheticMarker {
  synthetic: true;
  simulation_id: string;
  agent_id: string;
  created_by?: string;
}

export interface UsiCreatedEntity extends UsiSyntheticMarker {
  id: string;
  external_ref?: string;
  created_at?: string;
}

// ─────────────────────────────── manifiesto ───────────────────────────────

export interface UsiManifest {
  usi_version: string;
  app: {
    name: string;
    environment: UsiEnvironment;
    vertical: UsiVertical;
  };
  capabilities: UsiCapability[];
  requires_signature?: boolean;
  limits?: {
    max_batch_size?: number;
    requests_per_minute?: number;
  };
  content_types?: string[];
  interaction_types?: string[];
}

export interface UsiAuthVerification {
  authenticated: boolean;
  app_id: string;
  scopes: string[];
  token_expires_at: string | null;
}

// ─────────────────────────────── escrituras ───────────────────────────────

export interface UsiUserProfile {
  display_name: string;
  handle?: string;
  email?: string;
  bio?: string;
  birth_date?: string;
  gender?: string;
  location?: {
    city?: string;
    country?: string;
    lat?: number;
    lon?: number;
  };
  interests?: string[];
  avatar?: { kind: string; seed: string; url?: string };
  locale?: string;
  occupation?: string;
}

export interface UsiCreateUserRequest {
  agent_id: string;
  simulation_id: string;
  profile: UsiUserProfile;
  attributes?: Record<string, unknown>;
}

export interface UsiUpdateUserRequest {
  profile: Partial<UsiUserProfile>;
  attributes?: Record<string, unknown>;
}

export interface UsiMedia {
  kind: string;
  seed?: string;
  url?: string;
  alt?: string;
}

export interface UsiCreateContentRequest {
  agent_id: string;
  simulation_id: string;
  author_id: string;
  type: string;
  body?: string;
  media?: UsiMedia[];
  parent_id?: string | null;
  attributes?: Record<string, unknown>;
  /** Permite sembrar historial con fechas pasadas. */
  created_at?: string;
}

export type UsiTargetType = 'user' | 'content' | 'interaction';

export interface UsiCreateInteractionRequest {
  agent_id: string;
  simulation_id: string;
  actor_id: string;
  type: string;
  target_type: UsiTargetType;
  target_id: string;
  value?: number | string | null;
  attributes?: Record<string, unknown>;
}

export interface UsiSendMessageRequest {
  agent_id: string;
  simulation_id: string;
  conversation_id?: string | null;
  from_id: string;
  to_ids: string[];
  body: string;
  attributes?: Record<string, unknown>;
}

export interface UsiSentMessage extends UsiCreatedEntity {
  conversation_id: string;
}

// ─────────────────────────────── estado y purga ───────────────────────────────

export interface UsiCounts {
  users: number;
  content: number;
  interactions: number;
  messages: number;
}

export interface UsiState {
  healthy: boolean;
  usi_version: string;
  /** Contadores **solo de entidades sintéticas**. */
  counts: UsiCounts;
  by_simulation?: Array<{ simulation_id: string; [key: string]: unknown }>;
  /** Nonce de un solo uso, requerido por `POST /purge`. */
  purge_token?: string;
  purge_token_expires_at?: string;
  server_time?: string;
}

export interface UsiPurgeRequest {
  purge_token: string;
  scope: 'simulation' | 'all';
  simulation_id?: string;
  dry_run?: boolean;
}

export interface UsiPurgeResult {
  purged: UsiCounts;
  dry_run: boolean;
  completed_at?: string;
}

// ─────────────────────────────── auditoría ───────────────────────────────

export interface UsiAuditEvent {
  id: string;
  at: string;
  operation: string;
  entity_type: string;
  entity_id: string;
  simulation_id: string;
  agent_id?: string;
  result: string;
}

export interface UsiAuditPage {
  events: UsiAuditEvent[];
  next_cursor: string | null;
}

// ─────────────────────────────── errores ───────────────────────────────

export const USI_ERROR_CODES = [
  'invalid_request',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'unprocessable',
  'target_not_synthetic',
  'rate_limited',
  'capability_not_supported',
  'unavailable',
  'request_too_large',
  'internal_error',
] as const;

export type UsiErrorCode = (typeof USI_ERROR_CODES)[number];

export interface UsiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ─────────────────────────────── cabeceras ───────────────────────────────

export const USI_HEADERS = {
  /** Siempre `true`. Redundante con el cuerpo a propósito: permite filtrar en un proxy. */
  synthetic: 'x-usi-synthetic',
  simulationId: 'x-usi-simulation-id',
  idempotencyKey: 'idempotency-key',
  signature: 'x-usi-signature',
  timestamp: 'x-usi-timestamp',
  version: 'x-usi-version',
} as const;

/** Qué capacidad habilita cada endpoint. */
export const CAPABILITY_ENDPOINTS: Record<UsiCapability, { method: string; path: string }> = {
  'users.create': { method: 'POST', path: '/users' },
  'users.update': { method: 'PATCH', path: '/users/{id}' },
  'users.delete': { method: 'DELETE', path: '/users/{id}' },
  'content.create': { method: 'POST', path: '/content' },
  'interactions.create': { method: 'POST', path: '/interactions' },
  'messaging.send': { method: 'POST', path: '/messages' },
  'audit.read': { method: 'GET', path: '/audit' },
};
