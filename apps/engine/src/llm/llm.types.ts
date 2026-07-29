/**
 * Abstracción del proveedor de lenguaje.
 *
 * Existe por una razón concreta: **todo el sistema tiene que poder correr y
 * testearse sin API key**. `DeterministicProvider` genera texto plausible con
 * plantillas sembradas, así los tests son reproducibles, gratis y rápidos;
 * `AnthropicProvider` se usa cuando se quiere calidad real.
 */

export type GenerationPurpose =
  | 'reasoning'
  | 'profile'
  | 'content'
  | 'message'
  | 'decision';

export interface GenerationRequest {
  /** Determina qué modelo se usa y cuánto se invierte en la llamada. */
  readonly purpose: GenerationPurpose;
  readonly system: string;
  readonly prompt: string;
  readonly maxTokens?: number;
  /** Semilla del agente: hace reproducible al proveedor determinístico. */
  readonly seed?: string;
  readonly locale?: string;
  /** Etiquetas para métricas y auditoría. */
  readonly tags?: Record<string, string>;
}

export interface GenerationResult {
  readonly text: string;
  readonly model: string;
  readonly provider: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly durationMs: number;
  /**
   * True si el proveedor declinó generar. El motor lo trata como una acción
   * omitida, no como un error: la simulación sigue.
   */
  readonly refused?: boolean;
  readonly refusalCategory?: string | null;
}

export interface LlmProvider {
  readonly name: string;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

export const LLM_PROVIDER = Symbol('SUSP_LLM_PROVIDER');
