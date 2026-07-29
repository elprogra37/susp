import { Inject, Injectable, Logger } from '@nestjs/common';
import { Agent, AgentSchedule, Prisma } from '@prisma/client';
import { SeededRandom } from '../llm/seeded-random';
import { LLM_PROVIDER, LlmProvider } from '../llm/llm.types';
import { MemoryService } from './memory.service';
import {
  BehaviorRule,
  DecisionContext,
  DEFAULT_TRAITS,
  Goal,
  PlannedAction,
  RuleCondition,
  TRAIT_KEYS,
  Traits,
} from './agent.types';

/**
 * Decide qué haría un agente ahora y con qué contenido.
 *
 * El orden de decisión es deliberado:
 *
 *   1. ¿Está despierto? Fuera de sus franjas horarias, no hace nada.
 *   2. ¿Alguna regla de comportamiento aplica? Las reglas son determinísticas y
 *      mandan sobre el azar: "si no existís en la app, creá tu usuario primero".
 *   3. ¿Qué dice la mezcla del escenario? Elección ponderada, filtrada por lo
 *      que la app destino declaró soportar.
 *
 * Filtrar por capacidades acá y no al ejecutar evita encolar trabajo que la app
 * rechazaría con `501`.
 */
@Injectable()
export class BehaviorService {
  private readonly logger = new Logger(BehaviorService.name);

  constructor(
    private readonly memory: MemoryService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /**
   * Decide la próxima acción del agente, o `null` si no corresponde ninguna.
   * Devolver `null` es un resultado válido y frecuente: un agente dormido o sin
   * objetivos abiertos simplemente no actúa.
   */
  async decide(
    agent: Agent,
    schedules: AgentSchedule[],
    rules: BehaviorRule[],
    context: DecisionContext,
  ): Promise<PlannedAction | null> {
    const traits = this.readTraits(agent.traits);
    const rng = new SeededRandom(`${agent.seed}:decision:${agent.actionCount}`);

    // 1. Horario
    const slot = this.activeSlot(schedules, context.now);
    if (!slot) return null;

    // 2. Reglas
    const rule = await this.firstMatchingRule(agent, rules, traits, context);
    if (rule) {
      const action = await this.build(rule.then, agent, traits, rng, context, slot.weight);
      if (action) {
        return { ...action, rationale: `Regla "${rule.name}"`, priority: 10 };
      }
    }

    // 3. Mezcla del escenario, acotada a lo que la app soporta
    const available = this.availableOperations(context);
    if (Object.keys(available).length === 0) {
      this.logger.debug(
        `El agente ${agent.handle} no tiene ninguna operación disponible: ` +
          'la mezcla del escenario y las capacidades de la app no se solapan.',
      );
      return null;
    }

    const operation = rng.weighted(available);
    const action = await this.build(operation, agent, traits, rng, context, slot.weight);
    return action
      ? { ...action, rationale: `Mezcla del escenario (${operation})`, priority: 100 }
      : null;
  }

  // ─────────────────────────────── horario ───────────────────────────────

  /** Franja activa a esta hora, o null si el agente está "dormido". */
  activeSlot(schedules: AgentSchedule[], now: Date): AgentSchedule | null {
    const hour = now.getHours();
    const day = now.getDay();

    const matching = schedules.filter(
      (slot) =>
        (slot.dayOfWeek === null || slot.dayOfWeek === day) &&
        hour >= slot.startHour &&
        hour < slot.endHour,
    );

    if (matching.length === 0) return null;
    // Si se solapan, manda la de mayor peso.
    return matching.reduce((best, slot) => (slot.weight > best.weight ? slot : best));
  }

  // ─────────────────────────────── reglas ───────────────────────────────

  private async firstMatchingRule(
    agent: Agent,
    rules: BehaviorRule[],
    traits: Traits,
    context: DecisionContext,
  ): Promise<BehaviorRule | null> {
    const ordered = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (const rule of ordered) {
      if (!context.capabilities.includes(rule.then)) continue;
      if (await this.matches(rule.when, agent, traits)) return rule;
    }
    return null;
  }

  private async matches(
    condition: RuleCondition,
    agent: Agent,
    traits: Traits,
  ): Promise<boolean> {
    if (condition.missingExternalUser !== undefined) {
      const missing = agent.externalUserId === null;
      if (missing !== condition.missingExternalUser) return false;
    }
    if (condition.minActions !== undefined && agent.actionCount < condition.minActions) {
      return false;
    }
    if (condition.maxActions !== undefined && agent.actionCount > condition.maxActions) {
      return false;
    }
    for (const [key, threshold] of Object.entries(condition.traitAbove ?? {})) {
      if (traits[key as keyof Traits] <= (threshold as number)) return false;
    }
    for (const [key, threshold] of Object.entries(condition.traitBelow ?? {})) {
      if (traits[key as keyof Traits] >= (threshold as number)) return false;
    }
    if (condition.goalOpen) {
      const goals = this.readGoals(agent.goals);
      if (!goals.some((goal) => goal.kind === condition.goalOpen && !goal.done)) {
        return false;
      }
    }
    if (condition.hasMemoryTag) {
      const memories = await this.memory.recall({
        agentId: agent.id,
        tags: [condition.hasMemoryTag],
        limit: 1,
      });
      if (memories.length === 0) return false;
    }
    return true;
  }

  // ──────────────────────── construcción de la acción ────────────────────────

  /**
   * Arma el payload de una operación concreta. Devuelve `null` cuando la acción
   * no tiene sentido en este momento — por ejemplo, dar "me gusta" sin contenido
   * sintético al que dárselo.
   */
  private async build(
    operation: string,
    agent: Agent,
    traits: Traits,
    rng: SeededRandom,
    context: DecisionContext,
    slotWeight: number,
  ): Promise<Omit<PlannedAction, 'rationale' | 'priority'> | null> {
    const runAt = this.jitterTime(traits, slotWeight, context.timeScale, rng);

    switch (operation) {
      case 'users.create':
        return agent.externalUserId
          ? null // ya existe: no se crea dos veces
          : {
              operation,
              runAt,
              payload: { profile: agent.profile },
            };

      case 'users.update': {
        if (!agent.externalUserId) return null;
        const bio = await this.generate(agent, traits, 'profile', context);
        return {
          operation,
          runAt,
          payload: { externalUserId: agent.externalUserId, profile: { bio } },
        };
      }

      case 'content.create': {
        if (!agent.externalUserId) return null;
        const body = await this.generate(agent, traits, 'content', context);
        return {
          operation,
          runAt,
          payload: {
            authorId: agent.externalUserId,
            type: this.contentType(context.vertical, rng),
            body,
          },
        };
      }

      case 'interactions.create': {
        if (!agent.externalUserId) return null;
        // Solo se interactúa con contenido sintético de OTROS agentes: darse
        // "me gusta" a uno mismo no aporta nada a una demo.
        const targets = context.contentPool.filter((item) => item.agentId !== agent.id);
        if (targets.length === 0) return null;

        const target = rng.pick(targets);
        if (await this.memory.hasInteractedWith(agent.id, target.externalId)) {
          return null;
        }

        return {
          operation,
          runAt,
          payload: {
            actorId: agent.externalUserId,
            type: this.interactionType(context.vertical, traits, rng),
            targetType: 'content',
            targetId: target.externalId,
          },
        };
      }

      case 'messaging.send': {
        if (!agent.externalUserId) return null;
        const peers = context.peers.filter(
          (peer) => peer.id !== agent.id && peer.externalUserId,
        );
        if (peers.length === 0) return null;

        const peer = rng.pick(peers);
        const known = await this.memory.hasInteractedWith(agent.id, peer.externalUserId!);
        const body = await this.generate(
          agent,
          traits,
          'message',
          context,
          known ? 'followup' : 'opener',
        );

        return {
          operation,
          runAt,
          payload: {
            fromId: agent.externalUserId,
            toIds: [peer.externalUserId],
            body,
            peerAgentId: peer.id,
          },
        };
      }

      default:
        this.logger.warn(`Operación desconocida en la mezcla del escenario: "${operation}".`);
        return null;
    }
  }

  /** Pide texto al proveedor, pasándole la personalidad como etiquetas. */
  private async generate(
    agent: Agent,
    traits: Traits,
    purpose: 'profile' | 'content' | 'message',
    context: DecisionContext,
    kind?: string,
  ): Promise<string> {
    const recuerdos = await this.memory.summarize(agent.id, 4);

    const result = await this.llm.generate({
      purpose,
      seed: `${agent.seed}:${purpose}:${agent.actionCount}`,
      locale: agent.locale,
      system:
        `Sos ${agent.displayName}, un usuario sintético de una app de tipo ` +
        `${context.vertical}. Escribís en ${agent.locale}, en primera persona, ` +
        'natural y breve. No menciones que sos una simulación.',
      prompt:
        `Intereses: ${agent.interests.join(', ') || 'variados'}.\n` +
        `Recuerdos recientes:\n${recuerdos}\n\n` +
        this.promptFor(purpose, kind),
      tags: {
        vertical: context.vertical,
        ...(kind ? { kind } : {}),
        chattiness: String(traits.chattiness),
        formality: String(traits.formality),
        extraversion: String(traits.extraversion),
      },
    });

    // Una negativa del modelo no rompe la simulación: se omite la acción.
    if (result.refused) {
      this.logger.debug(
        `El proveedor declinó generar ${purpose} para ${agent.handle}; se omite.`,
      );
      return '';
    }

    return result.text;
  }

  private promptFor(purpose: string, kind?: string): string {
    switch (purpose) {
      case 'profile':
        return 'Escribí tu biografía de perfil, dos o tres frases.';
      case 'message':
        return kind === 'opener'
          ? 'Escribí un primer mensaje para alguien que no conocés.'
          : 'Escribí una respuesta breve para seguir la conversación.';
      case 'content':
      default:
        return 'Escribí una publicación para tu feed.';
    }
  }

  // ─────────────────────────────── utilidades ───────────────────────────────

  /**
   * Reparte la acción en el tiempo en vez de dispararla ya.
   *
   * Sin esto, todos los agentes actúan en el mismo instante y la app destino ve
   * un pico artificial que ninguna app real produce — además de un pico de carga
   * que puede hacerla fallar por una razón que no tiene nada que ver con la prueba.
   *
   * La espera se calcula en tiempo **simulado** y se convierte a tiempo real
   * dividiendo por `timeScale`: la cola del scheduler corre con el reloj de
   * verdad, así que el `runAt` tiene que ser real.
   */
  private jitterTime(
    traits: Traits,
    slotWeight: number,
    timeScale: number,
    rng: SeededRandom,
  ): Date {
    // Un agente más conversador espera menos entre acciones.
    const simulatedMinutes = 60 / Math.max(0.2, traits.chattiness * 2 * slotWeight);
    const spread = rng.float(0.3, 1.7);
    const simulatedMs = simulatedMinutes * spread * 60_000;
    const realMs = simulatedMs / Math.max(0.1, timeScale);
    return new Date(Date.now() + realMs);
  }

  private availableOperations(context: DecisionContext): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [operation, weight] of Object.entries(context.actionMix)) {
      if (weight > 0 && context.capabilities.includes(operation)) {
        result[operation] = weight;
      }
    }
    return result;
  }

  private contentType(vertical: string, rng: SeededRandom): string {
    switch (vertical) {
      case 'MARKETPLACE':
        return rng.bool(0.7) ? 'listing' : 'comment';
      case 'TELEMEDICINE':
        return rng.bool(0.6) ? 'consultation' : 'note';
      case 'DATING':
        return rng.bool(0.8) ? 'prompt' : 'photo';
      default:
        return rng.bool(0.65) ? 'post' : 'comment';
    }
  }

  private interactionType(
    vertical: string,
    traits: Traits,
    rng: SeededRandom,
  ): string {
    switch (vertical) {
      case 'DATING':
        // Un agente agradable descarta menos.
        return rng.bool(0.35 + traits.agreeableness * 0.3) ? 'like' : 'pass';
      case 'MARKETPLACE':
        return rng.bool(0.6) ? 'favorite' : 'offer';
      case 'TELEMEDICINE':
        return 'rating';
      default:
        return rng.bool(0.6) ? 'like' : rng.bool(0.5) ? 'follow' : 'share';
    }
  }

  private readTraits(raw: Prisma.JsonValue): Traits {
    const result = { ...DEFAULT_TRAITS };
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      for (const key of TRAIT_KEYS) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          result[key] = value;
        }
      }
    }
    return result;
  }

  private readGoals(raw: Prisma.JsonValue): Goal[] {
    return Array.isArray(raw) ? (raw as unknown as Goal[]) : [];
  }
}
