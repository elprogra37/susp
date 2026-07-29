import { Injectable, Logger } from '@nestjs/common';
import {
  AgentStatus,
  AuditResult,
  CampaignStatus,
  JobStatus,
  Persona,
  Prisma,
  Run,
  RunStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AgentFactoryService } from '../agents/agent-factory.service';
import { BehaviorService } from '../agents/behavior.service';
import { BehaviorRule, DecisionContext, Goal } from '../agents/agent.types';

/**
 * Convierte una campaña en trabajo concreto.
 *
 * El planificador **no** encola todo de entrada. Va tick a tick: le pregunta a
 * cada agente qué haría ahora y encola solo eso. Dos motivos:
 *
 * - Una campaña de 500 agentes por 8 horas serían cientos de miles de trabajos
 *   encolados de una vez, la mayoría obsoletos antes de ejecutarse.
 * - Un agente decide en función de lo que ya pasó. Si se planifica todo al
 *   principio, no hay nada que haya pasado todavía, y las interacciones dejan
 *   de tener sentido: nadie puede comentar un posteo que aún no existe.
 */
@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  /** Trabajos pendientes por agente antes de dejar de planificar más. */
  private static readonly MAX_PENDING_PER_AGENT = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentFactory: AgentFactoryService,
    private readonly behavior: BehaviorService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Arranca una ejecución: crea los agentes y encola su registro en la app.
   * Todo lo demás lo decide cada agente en los ticks siguientes.
   */
  async startRun(run: Run): Promise<void> {
    const campaign = await this.prisma.campaign.findUniqueOrThrow({
      where: { id: run.campaignId },
      include: { targetApp: true, scenario: true },
    });

    const personas = await this.resolvePersonas(campaign.tenantId, campaign);

    if (personas.length === 0) {
      await this.failRun(
        run,
        'No hay personas disponibles para esta campaña. Creá al menos una antes de arrancar.',
      );
      return;
    }

    const existing = await this.prisma.agent.count({ where: { campaignId: campaign.id } });
    if (existing === 0) {
      await this.agentFactory.createForCampaign({
        campaignId: campaign.id,
        count: campaign.agentCount,
        personas,
        vertical: campaign.targetApp.vertical,
        seed: run.id,
      });
    }

    // Primer trabajo de cada agente: existir en la app destino. Sin usuario no
    // puede publicar ni interactuar, así que va con prioridad máxima.
    const agents = await this.prisma.agent.findMany({
      where: { campaignId: campaign.id, externalUserId: null },
      select: { id: true, profile: true },
    });

    if (agents.length > 0) {
      if (!campaign.targetApp.capabilities.includes('users.create')) {
        await this.failRun(
          run,
          `La app "${campaign.targetApp.slug}" no declara la capacidad users.create, ` +
            'así que no se pueden crear usuarios sintéticos. Corré un chequeo de salud ' +
            'y revisá su manifiesto USI.',
        );
        return;
      }

      await this.prisma.job.createMany({
        data: agents.map((agent, index) => ({
          runId: run.id,
          agentId: agent.id,
          operation: 'users.create',
          payload: { profile: agent.profile } as Prisma.InputJsonValue,
          priority: 1,
          // Se escalonan de a poco para no dispararle a la app 500 altas en el
          // mismo instante, que ninguna app real recibiría.
          runAt: new Date(Date.now() + index * 250),
          idempotencyKey: randomUUID(),
        })),
      });
    }

    await this.prisma.run.update({
      where: { id: run.id },
      data: {
        status: RunStatus.RUNNING,
        startedAt: new Date(),
        jobsTotal: { increment: agents.length },
      },
    });

    await this.audit.record({
      tenantId: campaign.tenantId,
      runId: run.id,
      actor: 'planner',
      operation: 'run.start',
      result: run.dryRun ? AuditResult.DRY_RUN : AuditResult.OK,
      targetAppId: campaign.targetAppId,
      message: `Ejecución arrancada con ${agents.length} alta(s) de usuario encoladas.`,
    });

    this.logger.log(
      `Ejecución ${run.id} arrancada: ${agents.length} agentes por registrar` +
        `${run.dryRun ? ' [SIMULACIÓN]' : ''}.`,
    );
  }

  /**
   * Un tick de planificación: le pregunta a cada agente sin cola qué haría
   * ahora y encola el resultado.
   */
  async tick(run: Run): Promise<number> {
    const campaign = await this.prisma.campaign.findUniqueOrThrow({
      where: { id: run.campaignId },
      include: { targetApp: true, scenario: true },
    });

    // Ventana temporal de la campaña.
    if (campaign.endsAt && campaign.endsAt.getTime() < Date.now()) {
      await this.completeRun(run, campaign.id);
      return 0;
    }

    const context = await this.buildContext(run, campaign);
    if (Object.keys(context.actionMix).length === 0) {
      return 0;
    }

    // Solo agentes activos y sin trabajo pendiente: no tiene sentido pedirle
    // una acción nueva a alguien que todavía no ejecutó la anterior.
    const agents = await this.prisma.agent.findMany({
      where: {
        campaignId: campaign.id,
        status: { in: ['IDLE', 'ACTIVE'] },
        jobs: {
          none: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
        },
      },
      include: { schedules: true, persona: true },
      take: 100,
    });

    let planned = 0;

    for (const agent of agents) {
      const rules = this.readRules(agent.persona);
      const action = await this.behavior.decide(agent, agent.schedules, rules, context);
      if (!action) continue;

      await this.prisma.job.create({
        data: {
          runId: run.id,
          agentId: agent.id,
          operation: action.operation,
          payload: action.payload as Prisma.InputJsonValue,
          priority: action.priority,
          runAt: action.runAt,
          idempotencyKey: randomUUID(),
        },
      });
      planned += 1;
    }

    if (planned > 0) {
      await this.prisma.run.update({
        where: { id: run.id },
        data: { jobsTotal: { increment: planned } },
      });
    }

    if (planned === 0) {
      await this.maybeComplete(run, campaign.id);
    }

    return planned;
  }

  /**
   * Termina la ejecución solo cuando de verdad no queda nada por hacer.
   *
   * Que en este instante nadie tenga una acción para ejecutar **no** significa
   * que la campaña terminó: lo más común es que los agentes estén fuera de su
   * horario. Darla por completada ahí fue el primer bug del planificador —
   * arrancar una campaña de madrugada la cerraba en el acto, con seis usuarios
   * creados y nada más.
   *
   * Se cierra solo si todos los agentes cumplieron sus objetivos y no queda
   * ningún trabajo en vuelo. Si no, la ejecución sigue viva esperando el próximo
   * tramo activo; los ticks en vacío cuestan una consulta.
   */
  private async maybeComplete(run: Run, campaignId: string): Promise<void> {
    const inFlight = await this.prisma.job.count({
      where: { runId: run.id, status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
    });
    if (inFlight > 0) return;

    const agents = await this.prisma.agent.findMany({
      where: { campaignId },
      select: { id: true, goals: true },
    });
    if (agents.length === 0) return;

    const allDone = agents.every((agent) => {
      const goals = Array.isArray(agent.goals) ? (agent.goals as unknown as Goal[]) : [];
      // Un agente sin objetivos no bloquea el cierre de la campaña.
      return goals.length === 0 || goals.every((goal) => goal.done);
    });

    if (allDone) {
      await this.completeRun(run, campaignId);
    }
  }

  /**
   * Suma progreso al objetivo que corresponde a la operación ejecutada.
   * Lo llama el scheduler cuando un trabajo termina bien.
   */
  async recordGoalProgress(agentId: string, operation: string): Promise<void> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { goals: true },
    });
    if (!agent) return;

    const goals = Array.isArray(agent.goals) ? (agent.goals as unknown as Goal[]) : [];
    if (goals.length === 0) return;

    let changed = false;
    const updated = goals.map((goal) => {
      if (goal.kind !== operation || goal.done) return goal;
      changed = true;
      const progress = goal.progress + 1;
      return { ...goal, progress, done: progress >= goal.target };
    });

    if (!changed) return;

    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        goals: updated as unknown as Prisma.InputJsonValue,
        // Un agente que cumplió todo deja de recibir trabajo nuevo.
        ...(updated.every((goal) => goal.done) ? { status: AgentStatus.EXHAUSTED } : {}),
      },
    });
  }

  // ─────────────────────────────── contexto ───────────────────────────────

  private async buildContext(
    run: Run,
    campaign: Prisma.CampaignGetPayload<{ include: { targetApp: true; scenario: true } }>,
  ): Promise<DecisionContext> {
    const [peers, content] = await Promise.all([
      this.prisma.agent.findMany({
        where: { campaignId: campaign.id, externalUserId: { not: null } },
        select: { id: true, externalUserId: true },
        take: 200,
      }),
      this.prisma.syntheticEntity.findMany({
        where: { runId: run.id, kind: 'CONTENT', purgedAt: null },
        select: { externalId: true, agentId: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);

    return {
      now: this.simulatedNow(run, campaign.timeScale),
      timeScale: campaign.timeScale,
      vertical: campaign.targetApp.vertical,
      capabilities: campaign.targetApp.capabilities,
      actionMix: this.readActionMix(campaign.scenario?.actionMix),
      peers,
      contentPool: content,
    };
  }

  /**
   * Reloj simulado de la ejecución.
   *
   * Con `timeScale = 60`, un minuto real equivale a una hora simulada: una
   * campaña arrancada a medianoche llega al horario activo de sus agentes en
   * minutos en vez de esperar a la mañana siguiente. Es lo que hace usable una
   * demo sin tener que falsear los horarios de las personas.
   */
  private simulatedNow(run: Run, timeScale: number): Date {
    const startedAt = run.startedAt ?? run.createdAt;
    const realElapsed = Date.now() - startedAt.getTime();
    return new Date(startedAt.getTime() + realElapsed * Math.max(0.1, timeScale));
  }

  /**
   * Mezcla de acciones del escenario. Sin escenario se usa un reparto por
   * defecto razonable, para que una campaña mínima igual haga algo útil.
   */
  private readActionMix(raw: Prisma.JsonValue | undefined): Record<string, number> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>;
      const result: Record<string, number> = {};
      for (const [key, value] of Object.entries(record)) {
        const weight = Number(value);
        if (Number.isFinite(weight) && weight > 0) result[key] = weight;
      }
      if (Object.keys(result).length > 0) return result;
    }

    return {
      'content.create': 3,
      'interactions.create': 6,
      'messaging.send': 2,
      'users.update': 1,
    };
  }

  private readRules(persona: Persona | null): BehaviorRule[] {
    const rules = persona?.rules;
    if (!Array.isArray(rules)) return this.defaultRules();
    const parsed = rules as unknown as BehaviorRule[];
    return parsed.length > 0 ? parsed : this.defaultRules();
  }

  /**
   * Reglas mínimas que siempre aplican. La primera es la que evita el error más
   * obvio: intentar publicar antes de existir.
   */
  private defaultRules(): BehaviorRule[] {
    return [
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
  }

  // ─────────────────────────── fin de ejecución ───────────────────────────

  private async completeRun(run: Run, campaignId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.run.update({
        where: { id: run.id },
        data: { status: RunStatus.COMPLETED, finishedAt: new Date() },
      }),
      this.prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.COMPLETED },
      }),
    ]);
    this.logger.log(`Ejecución ${run.id} completada.`);
  }

  private async failRun(run: Run, reason: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.run.update({
        where: { id: run.id },
        data: { status: RunStatus.FAILED, finishedAt: new Date(), error: reason },
      }),
      this.prisma.campaign.update({
        where: { id: run.campaignId },
        data: { status: CampaignStatus.FAILED },
      }),
    ]);
    this.logger.error(`Ejecución ${run.id} falló: ${reason}`);
  }

  private async resolvePersonas(
    tenantId: string,
    campaign: Prisma.CampaignGetPayload<{ include: { targetApp: true } }>,
  ): Promise<Persona[]> {
    const config = (campaign.config ?? {}) as Record<string, unknown>;
    const requested = Array.isArray(config.personaIds)
      ? (config.personaIds as string[])
      : [];

    if (requested.length > 0) {
      return this.prisma.persona.findMany({
        where: { tenantId, id: { in: requested } },
      });
    }

    // Sin selección explícita: las del vertical de la app, y si no hay, todas.
    const byVertical = await this.prisma.persona.findMany({
      where: { tenantId, vertical: campaign.targetApp.vertical },
    });
    if (byVertical.length > 0) return byVertical;

    return this.prisma.persona.findMany({ where: { tenantId } });
  }
}
