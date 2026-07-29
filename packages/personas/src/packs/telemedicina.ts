import { HORARIO_DIURNO, HORARIO_MIXTO, HORARIO_OFICINA, REGLAS_BASE, type Pack } from '../tipos.ts';

/**
 * Telemedicina.
 *
 * El vertical más delicado de los cuatro, y el que exige más cuidado al
 * poblarlo.
 *
 * Los agentes generan **consultas de demostración**, no síntomas reales ni
 * historias clínicas plausibles de personas concretas. El contenido es
 * deliberadamente genérico —"vengo con dolor de cabeza hace tres días"— y nunca
 * incluye diagnósticos, medicación ni resultados de estudios: una demo tiene que
 * mostrar el circuito de la app, no fabricar información médica que después
 * alguien pueda leer como si fuera de un paciente.
 *
 * Por eso este pack no define personas de profesional de la salud: un agente
 * sintético emitiendo indicaciones médicas, aunque sea contra una base de
 * prueba, es contenido que no conviene que exista. El lado profesional se
 * demuestra con las cuentas reales del equipo.
 */
export const packTelemedicina: Pack = {
  vertical: 'TELEMEDICINE',
  notas:
    'Solo pacientes sintéticos, con consultas genéricas. Sin diagnósticos, sin ' +
    'medicación y sin resultados de estudios: una demo debe mostrar el circuito ' +
    'de la app, no fabricar información médica. El lado profesional se muestra ' +
    'con las cuentas reales del equipo.',

  requiere: {
    capabilities: ['users.create', 'users.update', 'content.create', 'messaging.send'],
    contentTypes: ['consultation', 'note'],
    interactionTypes: ['rating'],
  },

  personas: [
    {
      slug: 'tele-paciente-control',
      name: 'Paciente de control',
      vertical: 'TELEMEDICINE',
      description:
        'Consulta por chequeos de rutina y renovación de recetas. Es el caso más ' +
        'frecuente y el que mejor muestra el circuito completo sin dramatismo.',
      traits: {
        conscientiousness: 0.85,
        formality: 0.7,
        chattiness: 0.4,
        neuroticism: 0.3,
        agreeableness: 0.8,
      },
      interests: ['caminatas', 'jardinería', 'cocina'],
      goals: [
        { kind: 'content.create', target: 2, weight: 3 },
        { kind: 'messaging.send', target: 3, weight: 2 },
      ],
      schedule: HORARIO_OFICINA,
      rules: REGLAS_BASE,
      proporcion: 0.45,
    },
    {
      slug: 'tele-paciente-primera-vez',
      name: 'Paciente de primera consulta',
      vertical: 'TELEMEDICINE',
      description:
        'Nunca usó la app: pregunta mucho, escribe de más y necesita orientación. ' +
        'Sirve para probar el onboarding y los mensajes de ayuda.',
      traits: {
        neuroticism: 0.65,
        chattiness: 0.8,
        conscientiousness: 0.4,
        formality: 0.45,
        openness: 0.5,
      },
      interests: ['series', 'música'],
      goals: [
        { kind: 'content.create', target: 1, weight: 2 },
        { kind: 'messaging.send', target: 6, weight: 4 },
      ],
      schedule: HORARIO_MIXTO,
      rules: REGLAS_BASE,
      proporcion: 0.3,
    },
    {
      slug: 'tele-paciente-seguimiento',
      name: 'Paciente en seguimiento',
      vertical: 'TELEMEDICINE',
      description:
        'Ya viene de consultas anteriores y reporta cómo evoluciona. Genera el ' +
        'historial que hace que una demo no se vea recién estrenada.',
      traits: {
        conscientiousness: 0.7,
        chattiness: 0.5,
        formality: 0.6,
        agreeableness: 0.75,
        neuroticism: 0.4,
      },
      interests: ['natación', 'lectura', 'huerta'],
      goals: [
        { kind: 'content.create', target: 4, weight: 3 },
        { kind: 'messaging.send', target: 4, weight: 2 },
      ],
      schedule: HORARIO_DIURNO,
      rules: REGLAS_BASE,
      proporcion: 0.25,
    },
  ],

  escenarios: [
    {
      slug: 'tele-consultas',
      name: 'Consultas de demostración',
      vertical: 'TELEMEDICINE',
      description:
        'Ritmo bajo y realista: en telemedicina el volumen es mucho menor que en ' +
        'una red social, y una demo con cien consultas por hora se ve falsa.',
      actionMix: { 'content.create': 5, 'messaging.send': 4, 'users.update': 1 },
      intensity: 1,
    },
    {
      slug: 'tele-historial',
      name: 'Sembrar historial',
      vertical: 'TELEMEDICINE',
      description:
        'Genera consultas con fechas pasadas para que la app no se vea recién ' +
        'instalada al abrirla.',
      actionMix: { 'content.create': 8, 'users.update': 2 },
      intensity: 4,
      seed: { contentPerUser: 3, backdateDays: 90 },
    },
  ],
};
