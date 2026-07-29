import {
  HORARIO_DIURNO,
  HORARIO_MIXTO,
  HORARIO_OFICINA,
  REGLAS_BASE,
  type Pack,
} from '../tipos.ts';

/**
 * Marketplace.
 *
 * A diferencia de una red social, acá los roles no son grados de un mismo
 * comportamiento sino papeles distintos: quien vende no hace lo mismo que quien
 * compra. Un marketplace poblado solo de vendedores no tiene demanda, y uno
 * poblado solo de compradores no tiene nada que comprar.
 */
export const packMarketplace: Pack = {
  vertical: 'MARKETPLACE',
  notas:
    'Necesita las dos puntas para verse real. La proporción está inclinada hacia ' +
    'los compradores porque así funciona cualquier marketplace: se mira mucho más ' +
    'de lo que se publica.',

  requiere: {
    capabilities: [
      'users.create',
      'users.update',
      'content.create',
      'interactions.create',
      'messaging.send',
    ],
    contentTypes: ['listing', 'comment'],
    interactionTypes: ['favorite', 'offer'],
  },

  personas: [
    {
      slug: 'mkt-vendedor-habitual',
      name: 'Vendedor habitual',
      vertical: 'MARKETPLACE',
      description: 'Publica seguido y responde consultas rápido. Es quien llena el catálogo.',
      traits: {
        conscientiousness: 0.85,
        chattiness: 0.7,
        formality: 0.55,
        extraversion: 0.6,
        riskTolerance: 0.4,
      },
      interests: ['carpintería', 'ciclismo', 'fotografía', 'cerámica'],
      goals: [
        { kind: 'content.create', target: 10, weight: 5 },
        { kind: 'messaging.send', target: 8, weight: 2 },
      ],
      schedule: HORARIO_DIURNO,
      rules: [
        ...REGLAS_BASE,
        {
          name: 'publicar primero, después conversar',
          when: { maxActions: 4 },
          then: 'content.create',
          priority: 40,
        },
      ],
      proporcion: 0.2,
    },
    {
      slug: 'mkt-vendedor-ocasional',
      name: 'Vendedor ocasional',
      vertical: 'MARKETPLACE',
      description:
        'Publica una o dos cosas y desaparece. Es la mayoría de los vendedores ' +
        'reales, y el que deja publicaciones sin responder.',
      traits: {
        conscientiousness: 0.35,
        chattiness: 0.3,
        formality: 0.4,
        extraversion: 0.35,
      },
      interests: ['videojuegos', 'series', 'running'],
      goals: [{ kind: 'content.create', target: 2, weight: 3 }],
      schedule: HORARIO_MIXTO,
      rules: REGLAS_BASE,
      proporcion: 0.25,
    },
    {
      slug: 'mkt-comprador-cazador',
      name: 'Comprador cazador',
      vertical: 'MARKETPLACE',
      description:
        'Mira todo, guarda favoritos y ofrece por debajo. Genera el volumen de ' +
        'interacciones que hace que un catálogo se sienta con demanda.',
      traits: {
        riskTolerance: 0.7,
        agreeableness: 0.4,
        chattiness: 0.6,
        conscientiousness: 0.5,
        formality: 0.3,
      },
      interests: ['ciclismo', 'videojuegos', 'huerta', 'cocina'],
      goals: [
        { kind: 'interactions.create', target: 20, weight: 5 },
        { kind: 'messaging.send', target: 6, weight: 2 },
      ],
      schedule: HORARIO_MIXTO,
      rules: REGLAS_BASE,
      proporcion: 0.35,
    },
    {
      slug: 'mkt-comprador-decidido',
      name: 'Comprador decidido',
      vertical: 'MARKETPLACE',
      description:
        'Sabe lo que busca, pregunta poco y cierra. Aporta conversiones sin inflar ' +
        'el ruido.',
      traits: {
        conscientiousness: 0.8,
        chattiness: 0.35,
        formality: 0.65,
        riskTolerance: 0.3,
        agreeableness: 0.7,
      },
      interests: ['idiomas', 'ajedrez', 'jardinería'],
      goals: [
        { kind: 'interactions.create', target: 6, weight: 3 },
        { kind: 'messaging.send', target: 4, weight: 2 },
      ],
      schedule: HORARIO_OFICINA,
      rules: REGLAS_BASE,
      proporcion: 0.2,
    },
  ],

  escenarios: [
    {
      slug: 'mkt-catalogo',
      name: 'Poblar catálogo',
      vertical: 'MARKETPLACE',
      description:
        'Primero las publicaciones. Sin catálogo, los compradores no tienen sobre ' +
        'qué actuar.',
      actionMix: { 'content.create': 10, 'users.update': 2, 'interactions.create': 1 },
      intensity: 6,
      seed: { contentPerUser: 4 },
    },
    {
      slug: 'mkt-demanda',
      name: 'Simular demanda',
      vertical: 'MARKETPLACE',
      description: 'Favoritos, ofertas y consultas sobre un catálogo que ya existe.',
      actionMix: { 'interactions.create': 9, 'messaging.send': 4, 'content.create': 2 },
      intensity: 5,
    },
  ],
};
