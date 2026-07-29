/**
 * Packs por vertical: quiénes son los agentes y qué hacen.
 *
 * Un pack no es una lista de datos de relleno. Es un modelo de cómo se comporta
 * la gente en ese tipo de app: quién publica y quién solo mira, a qué hora se
 * conecta cada uno, qué persigue. De eso depende que un entorno poblado se
 * parezca a uno usado, y no a una tabla con filas.
 */

export type Vertical = 'DATING' | 'SOCIAL' | 'TELEMEDICINE' | 'MARKETPLACE';

export interface Rasgos {
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

export interface Objetivo {
  /** Operación USI que lo hace avanzar. */
  kind: string;
  target: number;
  weight?: number;
}

export interface FranjaHoraria {
  /** null = todos los días. 0 = domingo. */
  dayOfWeek: number | null;
  startHour: number;
  endHour: number;
  weight: number;
}

export interface Horario {
  slots: FranjaHoraria[];
}

export interface Regla {
  name: string;
  when: {
    missingExternalUser?: boolean;
    minActions?: number;
    maxActions?: number;
    traitAbove?: Rasgos;
    traitBelow?: Rasgos;
    goalOpen?: string;
    hasMemoryTag?: string;
  };
  /** Operación USI a ejecutar. */
  then: string;
  priority?: number;
}

export interface DefinicionPersona {
  slug: string;
  name: string;
  vertical: Vertical;
  description: string;
  traits: Rasgos;
  interests: string[];
  goals: Objetivo[];
  schedule: Horario;
  rules?: Regla[];
  /** Proporción sugerida dentro de una población. Se usa para repartir agentes. */
  proporcion: number;
}

export interface DefinicionEscenario {
  slug: string;
  name: string;
  vertical: Vertical;
  description: string;
  /** Peso relativo por operación USI. */
  actionMix: Record<string, number>;
  /** Acciones por agente y por hora, antes de la variación por personalidad. */
  intensity: number;
  seed?: Record<string, unknown>;
}

export interface Pack {
  vertical: Vertical;
  /** Para qué sirve el pack y qué supone del modelo de la app destino. */
  notas: string;
  personas: DefinicionPersona[];
  escenarios: DefinicionEscenario[];
  /** Tipos que la app destino debería declarar en su manifiesto USI. */
  requiere: {
    contentTypes: string[];
    interactionTypes: string[];
    capabilities: string[];
  };
}

// ───────────────────────── horarios reutilizables ─────────────────────────

/** Se conecta a la mañana y al mediodía. Perfil de rutina diurna. */
export const HORARIO_DIURNO: Horario = {
  slots: [
    { dayOfWeek: null, startHour: 8, endHour: 12, weight: 1.0 },
    { dayOfWeek: null, startHour: 13, endHour: 18, weight: 0.9 },
  ],
};

/** Picos de mediodía y de noche: el patrón más común en apps sociales. */
export const HORARIO_MIXTO: Horario = {
  slots: [
    { dayOfWeek: null, startHour: 12, endHour: 15, weight: 0.8 },
    { dayOfWeek: null, startHour: 19, endHour: 24, weight: 1.3 },
  ],
};

/** Se mueve de noche, y los fines de semana más. */
export const HORARIO_NOCTURNO: Horario = {
  slots: [
    { dayOfWeek: null, startHour: 21, endHour: 24, weight: 1.4 },
    { dayOfWeek: 5, startHour: 22, endHour: 24, weight: 1.8 },
    { dayOfWeek: 6, startHour: 22, endHour: 24, weight: 1.8 },
    { dayOfWeek: null, startHour: 0, endHour: 2, weight: 1.0 },
  ],
};

/** Horario de oficina estricto, de lunes a viernes. */
export const HORARIO_OFICINA: Horario = {
  slots: [
    { dayOfWeek: 1, startHour: 9, endHour: 18, weight: 1.0 },
    { dayOfWeek: 2, startHour: 9, endHour: 18, weight: 1.0 },
    { dayOfWeek: 3, startHour: 9, endHour: 18, weight: 1.0 },
    { dayOfWeek: 4, startHour: 9, endHour: 18, weight: 1.0 },
    { dayOfWeek: 5, startHour: 9, endHour: 17, weight: 0.8 },
  ],
};

/**
 * Reglas que aplican a cualquier vertical.
 *
 * La primera evita el error más obvio: intentar publicar antes de existir.
 */
export const REGLAS_BASE: Regla[] = [
  {
    name: 'registrarse antes que nada',
    when: { missingExternalUser: true },
    then: 'users.create',
    priority: 100,
  },
  {
    name: 'completar el perfil recién registrado',
    when: { missingExternalUser: false, maxActions: 1 },
    then: 'users.update',
    priority: 50,
  },
];
