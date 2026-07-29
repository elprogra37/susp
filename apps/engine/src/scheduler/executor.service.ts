import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AuditResult,
  Job,
  Prisma,
  SyntheticKind,
  TargetApp,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TargetAppsService } from '../target-apps/target-apps.service';
import { MemoryService } from '../agents/memory.service';
import { CONFIG, SuspConfig } from '../config/configuration';
import { UsiClient } from '../usi/usi.client';
import { UsiError } from '../usi/usi.errors';

export interface ExecutionOutcome {
  ok: boolean;
  /** True cuando el fallo puede resolverse solo y conviene reintentar. */
  retryable: boolean;
  externalId?: string;
  message?: string;
  httpStatus?: number;
  durationMs: number;
  skipped?: boolean;
}

/**
 * Ejecuta un trabajo: lo traduce a una llamada USI y espeja el resultado.
 *
 * Cada entidad creada se guarda en `SyntheticEntity`. **Ese espejo es lo que
 * hace posible la purga**: sin él no habría forma de enumerar exactamente lo
 * que el motor generó en la app destino, y la promesa de reversibilidad se
 * caería.
 */
@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly targetApps: TargetAppsService,
    private readonly audit: AuditService,
    private readonly memory: MemoryService,
    @Inject(CONFIG) private readonly config: SuspConfig,
  ) {}

  async execute(job: Job): Promise<ExecutionOutcome> {
    const startedAt = Date.now();

    const run = await this.prisma.run.findUnique({
      where: { id: job.runId },
      include: { campaign: { include: { targetApp: true } } },
    });
    if (!run) {
      return { ok: false, retryable: false, message: 'La ejecución ya no existe.', durationMs: 0 };
    }

    const app = run.campaign.targetApp;
    const tenantId = run.campaign.tenantId;
    const dryRun = run.dryRun || this.config.safety.dryRun;

    // Última barrera antes de escribir. Se comprueba acá, en el momento exacto
    // de la escritura, y no solo al arrancar la campaña: entre una cosa y otra
    // alguien pudo haber marcado la app como productiva.
    if (!dryRun) {
      try {
        this.targetApps.assertWritable(app);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.audit.record({
          tenantId,
          runId: run.id,
          actor: 'executor',
          operation: job.operation,
          result: AuditResult.REJECTED,
          targetAppId: app.id,
          agentId: job.agentId,
          message,
        });
        return { ok: false, retryable: false, message, durationMs: Date.now() - startedAt };
      }
    }

    // En modo simulación se registra el plan completo y no se llama a nadie.
    if (dryRun) {
      await this.audit.record({
        tenantId,
        runId: run.id,
        actor: 'executor',
        operation: job.operation,
        result: AuditResult.DRY_RUN,
        targetAppId: app.id,
        agentId: job.agentId,
        detail: job.payload as Prisma.InputJsonValue,
        message: 'Simulación: no se ejecutó ninguna escritura.',
        durationMs: Date.now() - startedAt,
      });
      return { ok: true, retryable: false, durationMs: Date.now() - startedAt, skipped: true };
    }

    const client = await this.targetApps.clientFor(app, run.id);

    try {
      const externalId = await this.dispatch(client, job, run.id, app);
      const durationMs = Date.now() - startedAt;

      await this.audit.record({
        tenantId,
        runId: run.id,
        actor: 'executor',
        operation: job.operation,
        result: AuditResult.OK,
        targetAppId: app.id,
        agentId: job.agentId,
        entityId: externalId,
        durationMs,
      });

      return { ok: true, retryable: false, externalId, durationMs };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const usiError = err instanceof UsiError ? err : null;
      const message = usiError ? usiError.message : String(err);

      // Un 422 no es un fallo del motor: la app aplicó sus reglas de negocio.
      // Se registra como rechazo y no se reintenta.
      const rejected = usiError?.kind === 'unprocessable';

      await this.audit.record({
        tenantId,
        runId: run.id,
        actor: 'executor',
        operation: job.operation,
        result: rejected ? AuditResult.REJECTED : AuditResult.ERROR,
        targetAppId: app.id,
        agentId: job.agentId,
        httpStatus: usiError?.httpStatus ?? null,
        durationMs,
        message,
        detail: { code: usiError?.code, kind: usiError?.kind } as Prisma.InputJsonValue,
      });

      if (!rejected) {
        this.logger.warn(`${job.operation} falló para el trabajo ${job.id}: ${message}`);
      }

      return {
        ok: false,
        retryable: usiError?.retryable ?? false,
        message,
        httpStatus: usiError?.httpStatus,
        durationMs,
      };
    }
  }

  // ───────────────────────── despacho por operación ─────────────────────────

  private async dispatch(
    client: UsiClient,
    job: Job,
    runId: string,
    app: TargetApp,
  ): Promise<string | undefined> {
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const agentId = job.agentId ?? 'sin-agente';

    switch (job.operation) {
      case 'users.create': {
        const created = await client.createUser(
          {
            agent_id: agentId,
            simulation_id: runId,
            profile: payload.profile as never,
          },
          job.idempotencyKey,
        );
        await this.mirror(app.id, runId, job.agentId, SyntheticKind.USER, created.id, payload);
        // El agente queda ligado a su usuario en la app: sin esto no puede
        // publicar ni interactuar.
        if (job.agentId) {
          await this.prisma.agent.update({
            where: { id: job.agentId },
            data: { externalUserId: created.id },
          });
          await this.memory.remember({
            agentId: job.agentId,
            content: 'Me registré en la aplicación.',
            tags: ['registro'],
            subject: created.id,
          });
        }
        return created.id;
      }

      case 'users.update': {
        const updated = await client.updateUser(
          String(payload.externalUserId),
          payload.profile as never,
          job.idempotencyKey,
        );
        return updated.id;
      }

      case 'content.create': {
        const created = await client.createContent(
          {
            agent_id: agentId,
            simulation_id: runId,
            author_id: String(payload.authorId),
            type: String(payload.type),
            body: payload.body ? String(payload.body) : undefined,
          },
          job.idempotencyKey,
        );
        await this.mirror(app.id, runId, job.agentId, SyntheticKind.CONTENT, created.id, payload);
        if (job.agentId) {
          await this.memory.remember({
            agentId: job.agentId,
            content: `Publiqué: "${String(payload.body ?? '').slice(0, 80)}"`,
            tags: ['publicacion'],
            subject: created.id,
          });
        }
        return created.id;
      }

      case 'interactions.create': {
        const created = await client.createInteraction(
          {
            agent_id: agentId,
            simulation_id: runId,
            actor_id: String(payload.actorId),
            type: String(payload.type),
            target_type: 'content',
            target_id: String(payload.targetId),
          },
          job.idempotencyKey,
        );
        await this.mirror(
          app.id,
          runId,
          job.agentId,
          SyntheticKind.INTERACTION,
          created.id,
          payload,
        );
        if (job.agentId) {
          await this.memory.remember({
            agentId: job.agentId,
            content: `Reaccioné (${String(payload.type)}) a una publicación.`,
            tags: ['interaccion'],
            // El sujeto es el objetivo: así el agente no repite la misma
            // interacción sobre el mismo contenido.
            subject: String(payload.targetId),
            strength: 0.6,
          });
        }
        return created.id;
      }

      case 'messaging.send': {
        const sent = await client.sendMessage(
          {
            agent_id: agentId,
            simulation_id: runId,
            from_id: String(payload.fromId),
            to_ids: payload.toIds as string[],
            body: String(payload.body),
          },
          job.idempotencyKey,
        );
        await this.mirror(app.id, runId, job.agentId, SyntheticKind.MESSAGE, sent.id, payload);
        if (job.agentId) {
          const [recipient] = (payload.toIds as string[]) ?? [];
          await this.memory.remember({
            agentId: job.agentId,
            content: `Le escribí a alguien: "${String(payload.body).slice(0, 60)}"`,
            tags: ['mensaje'],
            subject: recipient,
          });
        }
        return sent.id;
      }

      default:
        throw new UsiError(
          'unknown',
          `El ejecutor no sabe manejar la operación "${job.operation}".`,
        );
    }
  }

  /**
   * Guarda el espejo local de una entidad creada en la app destino.
   *
   * Se usa `upsert` porque un reintento con la misma clave de idempotencia
   * puede devolver el mismo id: la app no duplica, y el motor tampoco debe.
   */
  private async mirror(
    targetAppId: string,
    runId: string,
    agentId: string | null,
    kind: SyntheticKind,
    externalId: string,
    snapshot: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.syntheticEntity.upsert({
      where: { targetAppId_kind_externalId: { targetAppId, kind, externalId } },
      update: {},
      create: {
        targetAppId,
        runId,
        agentId,
        kind,
        externalId,
        snapshot: snapshot as Prisma.InputJsonValue,
      },
    });
  }
}
