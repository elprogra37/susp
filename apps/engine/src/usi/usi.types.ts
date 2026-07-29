/**
 * Tipos del estándar USI v1. Contrato en docs/USI.md.
 *
 * Se mantienen en el motor y se replican en `packages/usi-spec` para que el SDK
 * y la suite de conformidad usen exactamente las mismas formas.
 */

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

export type UsiEnvironment = 'development' | 'staging' | 'production';
export type UsiVertical =
  | 'dating'
  | 'social'
  | 'telemedicine'
  | 'marketplace'
  | 'other';

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

/** Marcado obligatorio presente en toda entidad creada vía USI. */
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
}

export interface UsiCreateUserRequest {
  agent_id: string;
  simulation_id: string;
  profile: UsiUserProfile;
  attributes?: Record<string, unknown>;
}

export interface UsiCreateContentRequest {
  agent_id: string;
  simulation_id: string;
  author_id: string;
  type: string;
  body?: string;
  media?: Array<{ kind: string; seed?: string; url?: string; alt?: string }>;
  parent_id?: string | null;
  attributes?: Record<string, unknown>;
  created_at?: string;
}

export interface UsiCreateInteractionRequest {
  agent_id: string;
  simulation_id: string;
  actor_id: string;
  type: string;
  target_type: 'user' | 'content' | 'interaction';
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

export interface UsiState {
  healthy: boolean;
  usi_version: string;
  counts: {
    users: number;
    content: number;
    interactions: number;
    messages: number;
  };
  by_simulation?: Array<{ simulation_id: string; [key: string]: unknown }>;
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
  purged: {
    users: number;
    content: number;
    interactions: number;
    messages: number;
  };
  dry_run: boolean;
  completed_at?: string;
}

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

/** Endpoints que toda implementación debe exponer, sin excepción. */
export const REQUIRED_ENDPOINTS = [
  'GET /manifest',
  'POST /auth/verify',
  'GET /state',
  'POST /purge',
] as const;
