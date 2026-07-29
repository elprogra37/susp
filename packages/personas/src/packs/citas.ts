import { HORARIO_MIXTO, HORARIO_NOCTURNO, REGLAS_BASE, type Pack } from '../tipos.ts';

/**
 * App de citas.
 *
 * Lo que hace o rompe una demo de citas es el **equilibrio de la conversación**:
 * si todos los agentes son igual de selectivos no se forma ni un match; si
 * ninguno descarta, el feed de matches pierde todo significado. Por eso las
 * proporciones y la tolerancia al descarte están calibradas, no elegidas al azar.
 */
export const packCitas: Pack = {
  vertical: 'DATING',
  notas:
    'Los agentes solo interactúan entre ellos, así que la demo muestra matches ' +
    'reales sin tocar a ninguna persona. La mezcla de selectivos y receptivos es ' +
    'lo que hace que se formen conversaciones en vez de silencio.',

  requiere: {
    capabilities: ['users.create', 'users.update', 'interactions.create', 'messaging.send'],
    contentTypes: ['prompt', 'photo'],
    interactionTypes: ['like', 'pass'],
  },

  personas: [
    {
      slug: 'citas-conversador',
      name: 'Conversador',
      vertical: 'DATING',
      description:
        'Escribe primero y sostiene la charla. Es quien arranca las conversaciones ' +
        'que después se ven en la demo.',
      traits: {
        extraversion: 0.9,
        chattiness: 0.9,
        agreeableness: 0.8,
        formality: 0.2,
        riskTolerance: 0.6,
      },
      interests: ['música en vivo', 'cocina', 'cine', 'senderismo'],
      goals: [
        { kind: 'messaging.send', target: 10, weight: 4 },
        { kind: 'interactions.create', target: 20, weight: 3 },
      ],
      schedule: HORARIO_NOCTURNO,
      rules: [
        ...REGLAS_BASE,
        {
          name: 'escribir después de varios likes',
          when: { minActions: 4, goalOpen: 'messaging.send' },
          then: 'messaging.send',
          priority: 30,
        },
      ],
      proporcion: 0.3,
    },
    {
      slug: 'citas-selectivo',
      name: 'Selectivo',
      vertical: 'DATING',
      description:
        'Mira mucho y elige poco. Sin agentes así, todos harían match con todos y ' +
        'el resultado no se parecería a ninguna app real.',
      traits: {
        agreeableness: 0.25,
        conscientiousness: 0.8,
        chattiness: 0.35,
        formality: 0.6,
        riskTolerance: 0.2,
      },
      interests: ['literatura', 'ajedrez', 'vinos', 'teatro'],
      goals: [{ kind: 'interactions.create', target: 25, weight: 5 }],
      schedule: HORARIO_MIXTO,
      rules: REGLAS_BASE,
      proporcion: 0.35,
    },
    {
      slug: 'citas-receptivo',
      name: 'Receptivo',
      vertical: 'DATING',
      description:
        'Responde a casi todo pero rara vez arranca. Es la contraparte del ' +
        'conversador: sin él, los mensajes no tendrían respuesta.',
      traits: {
        agreeableness: 0.9,
        extraversion: 0.45,
        chattiness: 0.55,
        neuroticism: 0.5,
        formality: 0.35,
      },
      interests: ['fotografía', 'yoga', 'natación', 'ilustración'],
      goals: [
        { kind: 'messaging.send', target: 6, weight: 3 },
        { kind: 'interactions.create', target: 15, weight: 2 },
      ],
      schedule: HORARIO_NOCTURNO,
      rules: REGLAS_BASE,
      proporcion: 0.35,
    },
  ],

  escenarios: [
    {
      slug: 'citas-descubrimiento',
      name: 'Descubrimiento',
      vertical: 'DATING',
      description: 'Mucho swipe, poca charla. Puebla el feed de perfiles y likes.',
      actionMix: { 'interactions.create': 10, 'messaging.send': 1, 'users.update': 2 },
      intensity: 8,
    },
    {
      slug: 'citas-conversaciones',
      name: 'Conversaciones',
      vertical: 'DATING',
      description:
        'Para mostrar el chat: asume que ya hay perfiles y matches, y se concentra ' +
        'en la mensajería.',
      actionMix: { 'messaging.send': 8, 'interactions.create': 3 },
      intensity: 4,
    },
  ],
};
