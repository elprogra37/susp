import { Injectable, Logger } from '@nestjs/common';
import { Job, JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Cola de trabajos durable, sobre PostgreSQL.
 *
 * Se reclama con `SELECT ... FOR UPDATE SKIP LOCKED`, que es la forma canónica
 * de hacer una cola en Postgres: varios workers pueden tomar lotes distintos en
 * paralelo sin bloquearse entre sí y sin entregar el mismo trabajo dos veces.
 *
 * ¿Por qué no Redis? Porque esto ya es transaccional, durable y sobrevive a un
 * reinicio sin configurar nada más, y el volumen de una simulación no justifica
 * sumar otro servicio a operar. Si algún día hace falta más throughput, esta
 * clase es la única que habría que reemplazar.
 */
@Injectable()
export class JobQueueService {
  private readonly logger = new Logger(JobQueueService.name);

  /** Un trabajo tomado hace más de esto se considera huérfano y se recupera. */
  private static readonly STALE_LOCK_MS = 5 * 60_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Toma hasta `limit` trabajos vencidos y los marca RUNNING de forma atómica.
   *
   * El `SKIP LOCKED` es lo que hace segura la concurrencia: si otro worker ya
   * tiene una fila bloqueada, esta consulta la saltea en vez de esperarla.
   */
  async claim(workerId: string, limit: number): Promise<Job[]> {
    return this.prisma.$queryRaw<Job[]>`
      UPDATE "jobs"
      SET "status"    = 'RUNNING'::"JobStatus",
          "lockedAt"  = NOW(),
          "lockedBy"  = ${workerId},
          "startedAt" = NOW(),
          "attempts"  = "attempts" + 1,
          "updatedAt" = NOW()
      WHERE "id" IN (
        SELECT "id" FROM "jobs"
        WHERE "status" = 'PENDING'::"JobStatus"
          AND "runAt" <= NOW()
        ORDER BY "priority" ASC, "runAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING *;
    `;
  }

  async succeed(jobId: string, durationMs: number): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.SUCCEEDED,
        finishedAt: new Date(),
        durationMs,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    });
  }

  /**
   * Marca el fallo. Si es reintentable y quedan intentos, vuelve a PENDING con
   * backoff exponencial; si no, muere y queda para inspección manual.
   *
   * Un trabajo DEAD no se borra: es la evidencia de qué falló y por qué, y el
   * dashboard lo muestra.
   */
  async fail(
    job: Job,
    error: string,
    retryable: boolean,
    durationMs: number,
  ): Promise<'retry' | 'dead'> {
    const canRetry = retryable && job.attempts < job.maxAttempts;

    if (canRetry) {
      // 2^n segundos con techo de 5 minutos, más jitter para que un lote que
      // falló junto no vuelva a intentarlo todo junto.
      const backoffMs = Math.min(2 ** job.attempts * 1000, 300_000);
      const jitter = Math.random() * 1000;

      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: JobStatus.PENDING,
          runAt: new Date(Date.now() + backoffMs + jitter),
          lockedAt: null,
          lockedBy: null,
          lastError: error.slice(0, 2000),
          durationMs,
        },
      });
      return 'retry';
    }

    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: retryable ? JobStatus.DEAD : JobStatus.FAILED,
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: error.slice(0, 2000),
        durationMs,
      },
    });
    return 'dead';
  }

  /**
   * Recupera trabajos que quedaron tomados por un worker que se cayó.
   *
   * Sin esto, un reinicio a destiempo dejaría trabajos en RUNNING para siempre y
   * la ejecución nunca terminaría.
   */
  async reclaimStale(): Promise<number> {
    const cutoff = new Date(Date.now() - JobQueueService.STALE_LOCK_MS);

    const result = await this.prisma.job.updateMany({
      where: { status: JobStatus.RUNNING, lockedAt: { lt: cutoff } },
      data: {
        status: JobStatus.PENDING,
        lockedAt: null,
        lockedBy: null,
        lastError: 'Recuperado: el worker que lo tomó no respondió.',
      },
    });

    if (result.count > 0) {
      this.logger.warn(`Recuperados ${result.count} trabajo(s) huérfanos.`);
    }
    return result.count;
  }

  /** Contadores por estado de una ejecución, para las métricas del dashboard. */
  async statsFor(runId: string): Promise<Record<JobStatus, number>> {
    const rows = await this.prisma.job.groupBy({
      by: ['status'],
      where: { runId },
      _count: { _all: true },
    });

    const stats = {
      PENDING: 0,
      RUNNING: 0,
      SUCCEEDED: 0,
      FAILED: 0,
      DEAD: 0,
      CANCELLED: 0,
    } as Record<JobStatus, number>;

    for (const row of rows) stats[row.status] = row._count._all;
    return stats;
  }

  /** Cuántos trabajos hay listos para ejecutarse ahora mismo. */
  async readyCount(): Promise<number> {
    return this.prisma.job.count({
      where: { status: JobStatus.PENDING, runAt: { lte: new Date() } },
    });
  }

  /** Cancela lo pendiente de una ejecución. */
  async cancelPending(runId: string): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: { runId, status: JobStatus.PENDING },
      data: { status: JobStatus.CANCELLED },
    });
    return result.count;
  }

  /** Ayuda a los tests a comprobar la forma del payload sin exponer Prisma. */
  static payloadOf(job: Job): Record<string, unknown> {
    return (job.payload ?? {}) as Prisma.JsonObject;
  }
}
