import {
  HORARIO_MIXTO,
  HORARIO_NOCTURNO,
  HORARIO_OFICINA,
  REGLAS_BASE,
  type Pack,
} from '../tipos.ts';

/**
 * Red social / comunidad de barrio.
 *
 * La distribución es lo que hace creíble un feed: la mayoría de la gente lee y
 * reacciona, unos pocos publican mucho. Poblar una app con cien agentes que
 * publican por igual da un feed que no se parece a ninguno real.
 */
export const packSocial: Pack = {
  vertical: 'SOCIAL',
  notas:
    'Pensado para feeds, comunidades y apps de barrio. La proporción sigue la ' +
    'regla del 1-9-90: pocos crean, algunos comentan, la mayoría reacciona.',

  requiere: {
    capabilities: ['users.create', 'users.update', 'content.create', 'interactions.create'],
    contentTypes: ['post', 'comment'],
    interactionTypes: ['like', 'follow', 'share'],
  },

  personas: [
    {
      slug: 'creador-constante',
      name: 'Creador constante',
      vertical: 'SOCIAL',
      description:
        'Publica varias veces por día y responde todo. Es el 1% que genera la ' +
        'mayor parte del contenido: sin un puñado de estos, el feed queda vacío.',
      traits: {
        extraversion: 0.9,
        openness: 0.8,
        chattiness: 0.95,
        formality: 0.2,
        agreeableness: 0.75,
        conscientiousness: 0.5,
      },
      interests: ['fotografía', 'ferias de barrio', 'cocina', 'música en vivo', 'ciclismo'],
      goals: [
        { kind: 'content.create', target: 8, weight: 3 },
        { kind: 'interactions.create', target: 15, weight: 2 },
      ],
      schedule: HORARIO_MIXTO,
      rules: REGLAS_BASE,
      proporcion: 0.08,
    },
    {
      slug: 'comentarista',
      name: 'Comentarista',
      vertical: 'SOCIAL',
      description:
        'Publica poco pero comenta todo. Es quien hace que un posteo se sienta ' +
        'conversado en vez de gritado al vacío.',
      traits: {
        extraversion: 0.7,
        agreeableness: 0.85,
        chattiness: 0.8,
        formality: 0.3,
        openness: 0.6,
      },
      interests: ['series', 'huerta', 'ajedrez', 'podcasts'],
      goals: [
        { kind: 'interactions.create', target: 25, weight: 4 },
        { kind: 'content.create', target: 2, weight: 1 },
      ],
      schedule: HORARIO_NOCTURNO,
      rules: REGLAS_BASE,
      proporcion: 0.22,
    },
    {
      slug: 'lector-silencioso',
      name: 'Lector silencioso',
      vertical: 'SOCIAL',
      description:
        'Reacciona, casi nunca escribe. Es la mayoría de cualquier comunidad, y ' +
        'el que hace que los contadores de "me gusta" tengan sentido.',
      traits: {
        extraversion: 0.2,
        chattiness: 0.15,
        agreeableness: 0.6,
        neuroticism: 0.4,
        formality: 0.5,
      },
      interests: ['cine', 'literatura', 'astronomía'],
      goals: [{ kind: 'interactions.create', target: 12, weight: 5 }],
      schedule: HORARIO_MIXTO,
      rules: REGLAS_BASE,
      proporcion: 0.55,
    },
    {
      slug: 'profesional-de-oficina',
      name: 'Profesional de oficina',
      vertical: 'SOCIAL',
      description:
        'Se conecta solo en horario laboral y escribe formal. Existe para que la ' +
        'actividad no se concentre toda de noche: un feed real tiene tráfico a ' +
        'las once de la mañana de un martes.',
      traits: {
        conscientiousness: 0.85,
        formality: 0.8,
        extraversion: 0.45,
        chattiness: 0.4,
        riskTolerance: 0.15,
      },
      interests: ['idiomas', 'running', 'vinos'],
      goals: [
        { kind: 'content.create', target: 3, weight: 1 },
        { kind: 'interactions.create', target: 8, weight: 2 },
      ],
      schedule: HORARIO_OFICINA,
      rules: REGLAS_BASE,
      proporcion: 0.15,
    },
  ],

  escenarios: [
    {
      slug: 'social-feed-activo',
      name: 'Feed activo',
      vertical: 'SOCIAL',
      description:
        'Ritmo de una comunidad sana: muchas reacciones, contenido moderado, ' +
        'algo de mensajería.',
      actionMix: {
        'interactions.create': 8,
        'content.create': 3,
        'messaging.send': 2,
        'users.update': 1,
      },
      intensity: 3,
    },
    {
      slug: 'social-arranque',
      name: 'Arranque de comunidad',
      vertical: 'SOCIAL',
      description:
        'Para un entorno vacío: primero se puebla de contenido, después llegan ' +
        'las reacciones. Sin esto, los primeros agentes no tienen a qué reaccionar.',
      actionMix: { 'content.create': 8, 'interactions.create': 2, 'users.update': 2 },
      intensity: 6,
      seed: { contentPerUser: 3 },
    },
    {
      slug: 'social-carga',
      name: 'Prueba de carga',
      vertical: 'SOCIAL',
      description:
        'Intensidad alta y sostenida para ver cómo aguanta la app. Conviene ' +
        'correrlo contra staging, nunca contra producción.',
      actionMix: { 'interactions.create': 10, 'content.create': 4, 'messaging.send': 3 },
      intensity: 30,
    },
  ],
};
