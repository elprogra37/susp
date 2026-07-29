import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { JobStatus, RunStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CONFIG, SuspConfig } from '../config/configuration';
import { JobQueueService } from './job-queue.service';
import { PlannerService } from './planner.service';
import { ExecutorService } from './executor.service';

/**
 * Bucle del scheduler.
 *
 * Cada vuelta hace tres cosas, en este orden:
 *   1. Arranca las ejecuciones que estén en PENDING.
 *   2. Planifica: le pregunta a los agentes qué harían ahora.
 *   3. Toma trabajos vencidos y los ejecuta.
 *
 * Es un `setTimeout` encadenado, no un `setInterval`: así una vuelta lenta no se
 * superpone con la siguiente. Con `setInterval`, un tick que tarde más que el
 * período apila ejecuciones hasta tumbar el proceso.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopping = false;
  /** Vueltas desde el último barrido de trabajos huérfanos. */
  private ticksSinceSweep = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
    private readonly planner: PlannerService,
    private readonly executor: ExecutorService,
    @Inject(CONFIG) private readonly config: SuspConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.scheduler.enabled) {
      this.logger.warn(
        'Scheduler desactivado (SUSP_SCHEDULER_ENABLED=false). Las campañas se ' +
          'van a encolar pero no se van a ejecutar.',
      );
      return;
    }
    this.logger.log(`Scheduler arrancado como worker ${this.workerId}`);
    this.schedule(0);
  }

  onApplicationShutdown(): void {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  /** Una vuelta completa. Nunca lanza: un fallo acá no puede matar el bucle. */
  private async tick(): Promise<void> {
    if (this.running || this.stopping) {
      this.schedule(this.config.scheduler.pollMs);
      return;
    }
    this.running = true;

    try {
      // Cada ~30 vueltas se recuperan los trabajos que quedaron tomados por un
      // worker caído. No hace falta más seguido y ahorra una consulta por tick.
      this.ticksSinceSweep += 1;
      if (this.ticksSinceSweep >= 30) {
        this.ticksSinceSweep = 0;
        await this.queue.reclaimStale();
      }

      await this.startPendingRuns();
      await this.planActiveRuns();
      const executed = await this.drainQueue();

      // Si hubo trabajo, se vuelve enseguida; si no, se espera el período
      // completo. Evita quemar CPU cuando no pasa nada.
      this.schedule(executed > 0 ? 50 : this.config.scheduler.pollMs);
    } catch (err) {
      this.logger.error(
        `Fallo en el tick del scheduler: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      this.schedule(this.config.scheduler.pollMs);
    } finally {
      this.running = false;
    }
  }

  // ─────────────────────────────── etapas ───────────────────────────────

  private async startPendingRuns(): Promise<void> {
    const pending = await this.prisma.run.findMany({
      where: { status: RunStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });

    for (const run of pending) {
      try {
        await this.planner.startRun(run);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`No se pudo arrancar la ejecución ${run.id}: ${message}`);
        await this.prisma.run.update({
          where: { id: run.id },
          data: { status: RunStatus.FAILED, error: message, finishedAt: new Date() },
        });
      }
    }
  }

  private async planActiveRuns(): Promise<void> {
    const active = await this.prisma.run.findMany({
      where: { status: RunStatus.RUNNING },
      orderBy: { startedAt: 'asc' },
      take: 10,
    });

    for (const run of active) {
      try {
        await this.planner.tick(run);
      } catch (err) {
        this.logger.error(
          `Fallo planificando la ejecución ${run.id}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async drainQueue(): Promise<number> {
    const jobs = await this.queue.claim(this.workerId, this.config.scheduler.batchSize);
    if (jobs.length === 0) return 0;

    // En paralelo: son llamadas HTTP a la app destino, y el lote ya está acotado
    // por `batchSize`. Serializarlas multiplicaría el tiempo de la vuelta sin
    // ninguna ganancia.
    await Promise.all(jobs.map((job) => this.runJob(job)));
    return jobs.length;
  }

  private async runJob(job: Awaited<ReturnType<JobQueueService['claim']>>[number]): Promise<void> {
    try {
      const outcome = await this.executor.execute(job);

      if (outcome.ok) {
        await this.queue.succeed(job.id, outcome.durationMs);
        await this.prisma.run.update({
          where: { id: job.runId },
          data: { jobsSucceeded: { increment: 1 } },
        });
        if (job.agentId) {
          await this.prisma.agent.update({
            where: { id: job.agentId },
            data: {
              actionCount: { increment: 1 },
              lastActedAt: new Date(),
              status: 'ACTIVE',
            },
          });
          // El progreso de objetivos es lo que permite que una campaña termine
          // sola en vez de quedar corriendo para siempre.
          await this.planner.recordGoalProgress(job.agentId, job.operation);
        }
        return;
      }

      const disposition = await this.queue.fail(
        job,
        outcome.message ?? 'Sin detalle.',
        outcome.retryable,
        outcome.durationMs,
      );

      if (disposition === 'dead') {
        await this.prisma.run.update({
          where: { id: job.runId },
          data: { jobsFailed: { increment: 1 } },
        });
        if (job.agentId) {
          await this.prisma.agent.update({
            where: { id: job.agentId },
            data: { errorCount: { increment: 1 } },
          });
        }
      }
    } catch (err) {
      // Red de contención: si el ejecutor rompe de forma inesperada, el trabajo
      // no puede quedarse en RUNNING para siempre.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error inesperado ejecutando el trabajo ${job.id}: ${message}`);
      await this.queue.fail(job, message, false, 0);
    }
  }

  /** Estado del scheduler, para `/health` y el dashboard. */
  async status(): Promise<{
    enabled: boolean;
    workerId: string;
    ready: number;
    running: number;
  }> {
    const [ready, runningJobs] = await Promise.all([
      this.queue.readyCount(),
      this.prisma.job.count({ where: { status: JobStatus.RUNNING } }),
    ]);

    return {
      enabled: this.config.scheduler.enabled,
      workerId: this.workerId,
      ready,
      running: runningJobs,
    };
  }
}
