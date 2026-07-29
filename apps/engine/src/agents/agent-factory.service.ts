import { Injectable, Logger } from '@nestjs/common';
import { Agent, Persona, Prisma, Vertical } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { SeededRandom } from '../llm/seeded-random';
import {
  APELLIDOS,
  CIUDADES,
  INTERESES,
  NOMBRES_F,
  NOMBRES_M,
  NOMBRES_X,
  PROFESIONES,
} from '../llm/corpus';
import {
  DEFAULT_TRAITS,
  Goal,
  ScheduleSlot,
  ScheduleTemplate,
  TRAIT_KEYS,
  Traits,
} from './agent.types';

/**
 * Crea los agentes de una campaña a partir de sus personas.
 *
 * Dos ideas guían el diseño:
 *
 * 1. **Variación individual.** Todos los agentes de una misma persona comparten
 *    su tendencia, pero ninguno es idéntico a otro: cada rasgo se muestrea de
 *    una normal centrada en el valor de la persona. Sin esto, mil agentes de la
 *    misma persona se comportan como un solo usuario clonado mil veces, y se
 *    nota enseguida.
 *
 * 2. **Reproducibilidad.** Cada agente guarda su semilla. La misma campaña con
 *    las mismas semillas produce exactamente los mismos agentes, así que un
 *    problema de simulación se puede reproducir en vez de perseguir.
 */
@Injectable()
export class AgentFactoryService {
  private readonly logger = new Logger(AgentFactoryService.name);

  /** Desvío estándar de la variación individual sobre el rasgo de la persona. */
  private static readonly TRAIT_JITTER = 0.12;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Genera y persiste los agentes de una campaña.
   * Es idempotente por handle: si ya existen, no los duplica.
   */
  async createForCampaign(params: {
    campaignId: string;
    count: number;
    personas: Persona[];
    vertical: Vertical;
    /** Semilla de la campaña; si no viene, se usa su id. */
    seed?: string;
    /**
     * Peso relativo por persona (id → peso). Sin esto, el reparto es parejo.
     *
     * Importa más de lo que parece: en una red social la mayoría lee y unos
     * pocos publican. Repartir en partes iguales produce un feed donde todos
     * escriben lo mismo, que no se parece a ninguna comunidad real.
     */
    weights?: Record<string, number>;
  }): Promise<Agent[]> {
    const { campaignId, count, personas, vertical } = params;

    if (personas.length === 0) {
      throw new Error(
        'No hay personas para instanciar. Definí al menos una persona antes de arrancar la campaña.',
      );
    }

    const campaignSeed = params.seed ?? campaignId;
    const created: Agent[] = [];
    const usedHandles = new Set<string>(
      (
        await this.prisma.agent.findMany({
          where: { campaignId },
          select: { handle: true },
        })
      ).map((a) => a.handle),
    );

    // El reparto se calcula una vez, antes del bucle: así es determinista y
    // respeta las proporciones en vez de depender del orden de creación.
    const asignacion = this.repartir(personas, count, params.weights);

    for (let index = 0; index < count; index++) {
      // Semilla por agente: determinista y única dentro de la campaña.
      const seed = `${campaignSeed}:agente:${index}`;
      const rng = new SeededRandom(seed);

      const persona = asignacion[index];

      const identity = this.identity(rng, usedHandles);
      const traits = this.deriveTraits(persona, rng);
      const interests = this.deriveInterests(persona, rng);

      const agent = await this.prisma.agent.create({
        data: {
          campaignId,
          personaId: persona.id,
          displayName: identity.displayName,
          handle: identity.handle,
          locale: this.pickLocale(persona, rng),
          traits: traits as unknown as Prisma.InputJsonValue,
          interests,
          profile: this.buildProfile(identity, interests, rng, vertical) as unknown as Prisma.InputJsonValue,
          goals: this.deriveGoals(persona, rng) as unknown as Prisma.InputJsonValue,
          seed,
        },
      });

      await this.createSchedule(agent.id, persona, traits, rng);
      created.push(agent);
    }

    this.logger.log(
      `Creados ${created.length} agentes para la campaña ${campaignId} ` +
        `a partir de ${personas.length} persona(s).`,
    );

    return created;
  }

  // ─────────────────────────────── reparto ───────────────────────────────

  /**
   * Decide qué persona le toca a cada agente.
   *
   * Con pesos, el reparto es proporcional; sin ellos, parejo. En los dos casos
   * cada persona recibe al menos un agente mientras el total alcance: un
   * arquetipo con cero instancias es lo mismo que no haberlo elegido.
   *
   * Devuelve un array de largo `count` para que el bucle de creación no tenga
   * que volver a decidir nada.
   */
  private repartir(
    personas: Persona[],
    count: number,
    weights?: Record<string, number>,
  ): Persona[] {
    if (personas.length === 0) return [];

    const pesos = personas.map((persona) => {
      const peso = weights?.[persona.id];
      return typeof peso === 'number' && peso > 0 ? peso : 1;
    });
    const totalPeso = pesos.reduce((suma, peso) => suma + peso, 0);

    // Orden descendente por peso: los sobrantes del redondeo van a las personas
    // más frecuentes, que es donde menos se nota la desviación.
    const orden = personas
      .map((persona, i) => ({ persona, peso: pesos[i] }))
      .sort((a, b) => b.peso - a.peso);

    // Menos agentes que personas: se eligen las más frecuentes en vez de
    // pasarse del total intentando dar una a cada una.
    if (count < orden.length) {
      return orden.slice(0, count).map((fila) => fila.persona);
    }

    const cantidades = orden.map((fila) =>
      Math.max(1, Math.floor((count * fila.peso) / totalPeso)),
    );

    let asignados = cantidades.reduce((suma, n) => suma + n, 0);
    for (let i = 0; asignados < count; i++) {
      cantidades[i % cantidades.length] += 1;
      asignados += 1;
    }
    for (let i = cantidades.length - 1; asignados > count && i >= 0; ) {
      if (cantidades[i] > 1) {
        cantidades[i] -= 1;
        asignados -= 1;
      } else {
        i -= 1;
      }
    }

    // Se intercalan en vez de agrupar: si los primeros veinte agentes fueran
    // todos del mismo arquetipo, un corte temprano de la campaña dejaría una
    // población sesgada.
    const pilas = cantidades.map((cantidad, i) =>
      Array.from({ length: cantidad }, () => orden[i].persona),
    );
    const resultado: Persona[] = [];
    for (let ronda = 0; resultado.length < count; ronda++) {
      for (const pila of pilas) {
        const persona = pila[ronda];
        if (persona && resultado.length < count) resultado.push(persona);
      }
    }

    return resultado;
  }

  // ─────────────────────────────── rasgos ───────────────────────────────

  /**
   * Rasgos del agente = rasgos de la persona + ruido individual.
   * Se recorta a 0..1 para que la variación no saque nada de escala.
   */
  deriveTraits(persona: Persona, rng: SeededRandom): Traits {
    const base = this.readTraits(persona.traits);
    const result = { ...DEFAULT_TRAITS };

    for (const key of TRAIT_KEYS) {
      result[key] = Number(
        rng.normal(base[key], AgentFactoryService.TRAIT_JITTER, 0, 1).toFixed(3),
      );
    }

    return result;
  }

  private readTraits(raw: Prisma.JsonValue): Traits {
    const result = { ...DEFAULT_TRAITS };
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      for (const key of TRAIT_KEYS) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          result[key] = Math.min(1, Math.max(0, value));
        }
      }
    }
    return result;
  }

  // ─────────────────────────────── identidad ───────────────────────────────

  private identity(
    rng: SeededRandom,
    used: Set<string>,
  ): { displayName: string; handle: string; firstName: string; lastName: string; gender: string } {
    const genderRoll = rng.next();
    const gender = genderRoll < 0.47 ? 'female' : genderRoll < 0.94 ? 'male' : 'nonbinary';
    const bank =
      gender === 'female' ? NOMBRES_F : gender === 'male' ? NOMBRES_M : NOMBRES_X;

    const firstName = rng.pick(bank);
    const lastName = rng.pick(APELLIDOS);
    const displayName = `${firstName} ${lastName}`;

    // El handle tiene que ser único dentro de la campaña: hay un índice único
    // en (campaignId, handle) y chocar abortaría la creación.
    const stem = `${firstName}${lastName.slice(0, 3)}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');

    let handle = stem;
    let suffix = 0;
    while (used.has(handle)) {
      suffix += 1;
      handle = `${stem}${suffix === 1 ? rng.int(10, 99) : rng.int(100, 9999)}`;
    }
    used.add(handle);

    return { displayName, handle, firstName, lastName, gender };
  }

  private pickLocale(persona: Persona, rng: SeededRandom): string {
    return persona.locales.length > 0 ? rng.pick(persona.locales) : 'es-AR';
  }

  private deriveInterests(persona: Persona, rng: SeededRandom): string[] {
    const pool = persona.interests.length > 0 ? persona.interests : [...INTERESES];
    // Un agente más abierto tiene más intereses declarados.
    const traits = this.readTraits(persona.traits);
    const count = Math.max(2, Math.round(2 + traits.openness * 5));
    return rng.sample(pool, count);
  }

  private buildProfile(
    identity: { displayName: string; handle: string; gender: string },
    interests: string[],
    rng: SeededRandom,
    vertical: Vertical,
  ): Record<string, unknown> {
    const place = rng.pick(CIUDADES);
    // Edad plausible según el vertical: en telemedicina el rango real es más ancho.
    const age = vertical === 'TELEMEDICINE' ? rng.int(18, 82) : rng.int(19, 55);
    const birthYear = new Date().getUTCFullYear() - age;

    return {
      display_name: identity.displayName,
      handle: identity.handle,
      // TLD reservado por la RFC 2606: imposible de entregar. Ningún correo
      // real puede salir por accidente hacia una casilla sintética.
      email: `${identity.handle}@demo.susp.invalid`,
      birth_date: `${birthYear}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
      gender: identity.gender,
      location: {
        city: place.city,
        country: place.country,
        lat: place.lat,
        lon: place.lon,
      },
      interests,
      occupation: rng.pick(PROFESIONES),
      avatar: { kind: 'procedural', seed: identity.handle },
    };
  }

  // ─────────────────────────────── objetivos ───────────────────────────────

  private deriveGoals(persona: Persona, rng: SeededRandom): Goal[] {
    const template = Array.isArray(persona.goals) ? persona.goals : [];

    if (template.length === 0) {
      // Sin plantilla, un objetivo genérico: existir y participar un poco.
      return [
        { kind: 'content.create', target: rng.int(2, 8), progress: 0, done: false, weight: 1 },
      ];
    }

    return template.map((raw): Goal => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const target = Number(item.target);
      return {
        kind: String(item.kind ?? 'content.create'),
        // El objetivo varía por agente: si todos apuntan al mismo número
        // exacto, la simulación termina de golpe y en bloque.
        target: Number.isFinite(target) && target > 0 ? rng.int(Math.max(1, Math.floor(target * 0.6)), Math.ceil(target * 1.4)) : rng.int(2, 8),
        progress: 0,
        done: false,
        weight: typeof item.weight === 'number' ? item.weight : 1,
      };
    });
  }

  // ─────────────────────────────── horarios ───────────────────────────────

  /**
   * Franjas de actividad. Si la persona no trae plantilla, se deriva del rasgo:
   * un agente muy extrovertido se mueve de noche, uno concienzudo en horario
   * de oficina. Nadie postea a las 4 de la mañana salvo que su perfil lo pida.
   */
  private async createSchedule(
    agentId: string,
    persona: Persona,
    traits: Traits,
    rng: SeededRandom,
  ): Promise<void> {
    const template = this.readSchedule(persona.schedule);
    const slots = template.slots?.length
      ? template.slots
      : this.defaultSlots(traits, rng);

    await this.prisma.agentSchedule.createMany({
      data: slots.map((slot) => ({
        agentId,
        dayOfWeek: slot.dayOfWeek,
        startHour: Math.min(23, Math.max(0, Math.round(slot.startHour))),
        endHour: Math.min(24, Math.max(1, Math.round(slot.endHour))),
        weight: slot.weight,
      })),
    });
  }

  private readSchedule(raw: Prisma.JsonValue): ScheduleTemplate {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as unknown as ScheduleTemplate;
  }

  private defaultSlots(traits: Traits, rng: SeededRandom): ScheduleSlot[] {
    const nocturno = traits.extraversion > 0.65 && traits.conscientiousness < 0.5;
    const oficina = traits.conscientiousness > 0.65;

    if (nocturno) {
      return [
        { dayOfWeek: null, startHour: rng.int(19, 21), endHour: 24, weight: 1.3 },
        { dayOfWeek: null, startHour: 12, endHour: 15, weight: 0.6 },
      ];
    }
    if (oficina) {
      return [
        { dayOfWeek: null, startHour: rng.int(7, 9), endHour: 12, weight: 1.0 },
        { dayOfWeek: null, startHour: 13, endHour: rng.int(17, 19), weight: 1.1 },
      ];
    }
    return [
      { dayOfWeek: null, startHour: rng.int(9, 11), endHour: 14, weight: 1.0 },
      { dayOfWeek: null, startHour: rng.int(17, 20), endHour: 23, weight: 1.2 },
    ];
  }
}
