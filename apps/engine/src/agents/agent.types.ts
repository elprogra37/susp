/**
 * Tipos del motor de agentes.
 *
 * Un agente sintético no es un generador de datos al azar: tiene rasgos
 * estables, recuerda lo que hizo, persigue objetivos y solo actúa en las horas
 * en que su persona estaría despierta. Esa coherencia a lo largo del tiempo es
 * lo que separa una demo creíble de una tabla llena de ruido.
 */

export interface Traits {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  /** Cuánto y con qué frecuencia escribe. */
  chattiness: number;
  /** Propensión a acciones poco habituales o de mayor impacto. */
  riskTolerance: number;
  /** 0 = coloquial, 1 = formal. */
  formality: number;
}

export const DEFAULT_TRAITS: Traits = {
  openness: 0.5,
  conscientiousness: 0.5,
  extraversion: 0.5,
  agreeableness: 0.5,
  neuroticism: 0.5,
  chattiness: 0.5,
  riskTolerance: 0.3,
  formality: 0.5,
};

export const TRAIT_KEYS = Object.keys(DEFAULT_TRAITS) as Array<keyof Traits>;

/** Objetivo del agente, con progreso. */
export interface Goal {
  kind: string;
  /** Cuántas veces hay que cumplirlo para darlo por terminado. */
  target: number;
  progress: number;
  done: boolean;
  /** Peso relativo frente a otros objetivos abiertos. */
  weight?: number;
}

/** Franja horaria de actividad. `dayOfWeek` null = todos los días. */
export interface ScheduleSlot {
  dayOfWeek: number | null;
  startHour: number;
  endHour: number;
  weight: number;
}

export interface ScheduleTemplate {
  /** Perfil de referencia; si falta, se deriva de los rasgos. */
  preset?: 'diurno' | 'nocturno' | 'oficina' | 'irregular';
  slots?: ScheduleSlot[];
  /** Multiplicador general de actividad. */
  intensity?: number;
}

/**
 * Regla de comportamiento: condición → acción.
 * Se evalúan antes que la elección ponderada del escenario, así que sirven para
 * forzar conductas específicas de un vertical ("si no tenés perfil, creá uno").
 */
export interface BehaviorRule {
  /** Nombre legible, para la auditoría. */
  name: string;
  when: RuleCondition;
  /** Operación USI a ejecutar. */
  then: string;
  /** Prioridad: mayor gana. */
  priority?: number;
}

export interface RuleCondition {
  /** El agente todavía no existe en la app destino. */
  missingExternalUser?: boolean;
  /** Cantidad mínima/máxima de acciones ya ejecutadas. */
  minActions?: number;
  maxActions?: number;
  /** Rasgo por encima/por debajo de un umbral. */
  traitAbove?: Partial<Traits>;
  traitBelow?: Partial<Traits>;
  /** Hay memorias con esta etiqueta. */
  hasMemoryTag?: string;
  /** Objetivo abierto de este tipo. */
  goalOpen?: string;
}

/** Acción concreta que el agente decidió ejecutar. */
export interface PlannedAction {
  /** Operación USI: users.create, content.create, interactions.create… */
  operation: string;
  /** Momento en que debería ejecutarse. */
  runAt: Date;
  /** Menor número = antes. */
  priority: number;
  payload: Record<string, unknown>;
  /** Por qué se eligió, para la auditoría. */
  rationale: string;
}

/** Contexto que el motor le da al agente para decidir. */
export interface DecisionContext {
  /**
   * Hora **simulada**. Con `timeScale > 1` avanza más rápido que el reloj real,
   * y es contra esta hora que se evalúan los horarios del agente. Sin esto, una
   * demo arrancada a medianoche no haría nada: todos los agentes estarían
   * dormidos y habría que esperar a la mañana.
   */
  readonly now: Date;
  /** 1 = tiempo real; 60 = una hora simulada por minuto real. */
  readonly timeScale: number;
  readonly vertical: string;
  /** Operaciones que la app destino declaró soportar. */
  readonly capabilities: readonly string[];
  /** Mezcla de acciones del escenario. */
  readonly actionMix: Readonly<Record<string, number>>;
  /** Otros agentes de la campaña con los que puede interactuar. */
  readonly peers: ReadonlyArray<{ id: string; externalUserId: string | null }>;
  /** Contenido sintético ya creado, para poder interactuar con él. */
  readonly contentPool: ReadonlyArray<{ externalId: string; agentId: string | null }>;
}
