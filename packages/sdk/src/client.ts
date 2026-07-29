import type {
  Agent,
  ApiKeyView,
  AuditEvent,
  AuditSummaryRow,
  Campaign,
  CreateCampaignInput,
  CreatePersonaInput,
  CreateScenarioInput,
  CreateTargetAppInput,
  Job,
  Page,
  Persona,
  PurgeCampaignResult,
  Run,
  RunDetail,
  Scenario,
  SyntheticEntity,
  TargetApp,
  Tenant,
} from './types.ts';
import { SuspError } from './errors.ts';

export interface SuspClientOptions {
  /** URL base de la API del motor, por ejemplo http://localhost:55701/api/v1 */
  baseUrl: string;
  /** API key (`X-Susp-Key`). Alternativa: `jwt`. */
  apiKey?: string;
  /** Token de sesión del dashboard. */
  jwt?: string;
  timeoutMs?: number;
  /** Inyectable para testear sin red. */
  fetchImpl?: typeof fetch;
}

/**
 * Cliente tipado del motor SUSP.
 *
 * Existe para que integrar SUSP en un script de CI o en una herramienta interna
 * no implique escribir `fetch` a mano y adivinar las formas de las respuestas.
 * Es una capa fina sobre HTTP: no guarda estado ni cachea nada.
 */
export class SuspClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly jwt?: string;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(options: SuspClientOptions) {
    if (!options.apiKey && !options.jwt) {
      throw new Error('Hace falta apiKey o jwt para hablar con el motor.');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.jwt = options.jwt;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.doFetch = options.fetchImpl ?? globalThis.fetch;
  }

  // ─────────────────────────────── tenant ───────────────────────────────

  tenant(): Promise<Tenant> {
    return this.request('GET', '/tenant');
  }

  listApiKeys(params: Pagination = {}): Promise<Page<ApiKeyView>> {
    return this.request('GET', '/tenant/api-keys', undefined, params);
  }

  /** El valor en claro solo se devuelve acá, una vez. Guardalo enseguida. */
  createApiKey(input: {
    name: string;
    role?: 'OWNER' | 'OPERATOR' | 'VIEWER';
    expiresInDays?: number;
  }): Promise<ApiKeyView & { key: string; warning: string }> {
    return this.request('POST', '/tenant/api-keys', input);
  }

  revokeApiKey(id: string): Promise<void> {
    return this.request('DELETE', `/tenant/api-keys/${encodeURIComponent(id)}`);
  }

  // ───────────────────────────── apps destino ─────────────────────────────

  listTargetApps(params: Pagination = {}): Promise<Page<TargetApp>> {
    return this.request('GET', '/target-apps', undefined, params);
  }

  getTargetApp(id: string): Promise<TargetApp> {
    return this.request('GET', `/target-apps/${encodeURIComponent(id)}`);
  }

  createTargetApp(input: CreateTargetAppInput): Promise<TargetApp> {
    return this.request('POST', '/target-apps', input);
  }

  updateTargetApp(id: string, input: Partial<CreateTargetAppInput>): Promise<TargetApp> {
    return this.request('PATCH', `/target-apps/${encodeURIComponent(id)}`, input);
  }

  deleteTargetApp(id: string): Promise<void> {
    return this.request('DELETE', `/target-apps/${encodeURIComponent(id)}`);
  }

  /** Lee el manifiesto de la app, verifica credenciales y cachea capacidades. */
  checkTargetAppHealth(id: string): Promise<TargetApp> {
    return this.request('POST', `/target-apps/${encodeURIComponent(id)}/health-check`, {});
  }

  /**
   * Habilita o deshabilita escrituras contra una app de producción.
   * Deliberadamente incómodo: exige el slug exacto y la frase exacta.
   */
  setProductionWrites(
    id: string,
    input: { allow: boolean; confirmSlug: string; confirmPhrase: 'ENTIENDO EL RIESGO' },
  ): Promise<TargetApp> {
    return this.request('POST', `/target-apps/${encodeURIComponent(id)}/production-writes`, input);
  }

  // ──────────────────────── personas y escenarios ────────────────────────

  listPersonas(params: Pagination & { vertical?: string } = {}): Promise<Page<Persona>> {
    return this.request('GET', '/personas', undefined, params);
  }

  createPersona(input: CreatePersonaInput): Promise<Persona> {
    return this.request('POST', '/personas', input);
  }

  updatePersona(id: string, input: Partial<CreatePersonaInput>): Promise<Persona> {
    return this.request('PATCH', `/personas/${encodeURIComponent(id)}`, input);
  }

  deletePersona(id: string): Promise<void> {
    return this.request('DELETE', `/personas/${encodeURIComponent(id)}`);
  }

  listScenarios(params: Pagination & { vertical?: string } = {}): Promise<Page<Scenario>> {
    return this.request('GET', '/scenarios', undefined, params);
  }

  createScenario(input: CreateScenarioInput): Promise<Scenario> {
    return this.request('POST', '/scenarios', input);
  }

  updateScenario(id: string, input: Partial<CreateScenarioInput>): Promise<Scenario> {
    return this.request('PATCH', `/scenarios/${encodeURIComponent(id)}`, input);
  }

  deleteScenario(id: string): Promise<void> {
    return this.request('DELETE', `/scenarios/${encodeURIComponent(id)}`);
  }

  // ─────────────────────────────── campañas ───────────────────────────────

  listCampaigns(params: Pagination & { status?: string } = {}): Promise<Page<Campaign>> {
    return this.request('GET', '/campaigns', undefined, params);
  }

  getCampaign(id: string): Promise<Campaign> {
    return this.request('GET', `/campaigns/${encodeURIComponent(id)}`);
  }

  createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    return this.request('POST', '/campaigns', input);
  }

  updateCampaign(id: string, input: Partial<CreateCampaignInput>): Promise<Campaign> {
    return this.request('PATCH', `/campaigns/${encodeURIComponent(id)}`, input);
  }

  deleteCampaign(id: string): Promise<void> {
    return this.request('DELETE', `/campaigns/${encodeURIComponent(id)}`);
  }

  /** Encola una ejecución. El scheduler la toma desde ahí. */
  startCampaign(id: string, options: { dryRun?: boolean } = {}): Promise<Run> {
    return this.request('POST', `/campaigns/${encodeURIComponent(id)}/start`, options);
  }

  pauseCampaign(id: string): Promise<Campaign> {
    return this.request('POST', `/campaigns/${encodeURIComponent(id)}/pause`, {});
  }

  cancelCampaign(id: string): Promise<Campaign> {
    return this.request('POST', `/campaigns/${encodeURIComponent(id)}/cancel`, {});
  }

  /**
   * Borra en la app destino todo lo que generó esta campaña.
   * `confirmName` tiene que ser el nombre exacto: es a propósito.
   */
  purgeCampaign(
    id: string,
    input: { confirmName: string; dryRun?: boolean },
  ): Promise<PurgeCampaignResult> {
    return this.request('POST', `/campaigns/${encodeURIComponent(id)}/purge`, input);
  }

  // ─────────────────────── ejecuciones y agentes ───────────────────────

  listRuns(params: Pagination & { campaignId?: string; status?: string } = {}): Promise<Page<Run>> {
    return this.request('GET', '/runs', undefined, params);
  }

  getRun(id: string): Promise<RunDetail> {
    return this.request('GET', `/runs/${encodeURIComponent(id)}`);
  }

  listJobs(
    runId: string,
    params: Pagination & { status?: string; operation?: string } = {},
  ): Promise<Page<Job>> {
    return this.request('GET', `/runs/${encodeURIComponent(runId)}/jobs`, undefined, params);
  }

  /** Entidades creadas en la app destino por esta ejecución. */
  listEntities(runId: string, params: Pagination = {}): Promise<Page<SyntheticEntity>> {
    return this.request('GET', `/runs/${encodeURIComponent(runId)}/entities`, undefined, params);
  }

  listAgents(params: Pagination & { campaignId?: string; status?: string } = {}): Promise<Page<Agent>> {
    return this.request('GET', '/agents', undefined, params);
  }

  getAgent(id: string): Promise<Agent> {
    return this.request('GET', `/agents/${encodeURIComponent(id)}`);
  }

  /** Memoria del agente, con la fuerza ya decaída por el tiempo transcurrido. */
  getAgentMemories(id: string, params: Pagination & { kind?: string } = {}) {
    return this.request<Page<Record<string, unknown>>>(
      'GET',
      `/agents/${encodeURIComponent(id)}/memories`,
      undefined,
      params,
    );
  }

  // ─────────────────────────────── auditoría ───────────────────────────────

  listAudit(
    params: Pagination & {
      runId?: string;
      operation?: string;
      result?: string;
      since?: string;
    } = {},
  ): Promise<Page<AuditEvent>> {
    return this.request('GET', '/audit', undefined, params);
  }

  auditSummary(hours = 24): Promise<AuditSummaryRow[]> {
    return this.request('GET', '/audit/summary', undefined, { hours });
  }

  // ─────────────────────────────── utilidades ───────────────────────────────

  /**
   * Espera a que una ejecución termine. Útil en un script de CI que puebla un
   * entorno y necesita saber cuándo seguir.
   */
  async waitForRun(
    runId: string,
    options: { pollMs?: number; timeoutMs?: number } = {},
  ): Promise<RunDetail> {
    const pollMs = options.pollMs ?? 3000;
    const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
    const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

    for (;;) {
      const run = await this.getRun(runId);
      if (terminal.has(run.status)) return run;

      if (Date.now() > deadline) {
        throw new SuspError(
          'timeout',
          `La ejecución ${runId} sigue en ${run.status} después del tiempo de espera. ` +
            'Puede ser normal: una campaña sin fecha de fin corre hasta que sus agentes ' +
            'cumplen sus objetivos.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  // ─────────────────────────────── transporte ───────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    // `object` y no `Record<string, ...>`: una interfaz declarada (como
    // `Pagination`) no tiene índice implícito, así que no encajaría en un
    // Record aunque sus valores sean del tipo correcto.
    query?: object,
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.apiKey) headers['x-susp-key'] = this.apiKey;
    if (this.jwt) headers.authorization = `Bearer ${this.jwt}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    try {
      const response = await this.doFetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 204) return undefined as T;

      const text = await response.text();
      if (!response.ok) throw SuspError.fromResponse(response.status, text);
      if (text.trim() === '') return undefined as T;

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new SuspError('invalid_response', 'El motor devolvió algo que no es JSON.');
      }
    } catch (err) {
      if (err instanceof SuspError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SuspError('timeout', `El motor no respondió en ${this.timeoutMs} ms.`);
      }
      throw new SuspError(
        'network',
        `No se pudo contactar el motor: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface Pagination {
  limit?: number;
  offset?: number;
}
