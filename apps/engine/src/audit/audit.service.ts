import { Injectable, Logger } from '@nestjs/common';
import { AuditResult, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

export interface AuditRecord {
  tenantId: string;
  runId?: string | null;
  /** Quién originó la operación: un servicio del motor o una credencial. */
  actor: string;
  operation: string;
  result?: AuditResult;
  targetAppId?: string | null;
  agentId?: string | null;
  entityId?: string | null;
  httpStatus?: number | null;
  durationMs?: number | null;
  detail?: Prisma.InputJsonValue;
  message?: string | null;
}

/**
 * Registro append-only: nunca se actualiza ni se borra.
 *
 * Auditar no puede tumbar la operación que se está auditando, así que un fallo
 * al escribir se registra en el log y sigue. Perder una línea de auditoría es
 * malo; abortar una purga a mitad de camino por no poder anotarla, peor.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditRecord): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          tenantId: entry.tenantId,
          runId: entry.runId ?? null,
          actor: entry.actor,
          operation: entry.operation,
          result: entry.result ?? AuditResult.OK,
          targetAppId: entry.targetAppId ?? null,
          agentId: entry.agentId ?? null,
          entityId: entry.entityId ?? null,
          httpStatus: entry.httpStatus ?? null,
          durationMs: entry.durationMs ?? null,
          detail: entry.detail ?? {},
          message: entry.message ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `No se pudo registrar la auditoría de ${entry.operation}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async list(
    tenantId: string,
    filters: {
      runId?: string;
      operation?: string;
      result?: AuditResult;
      since?: Date;
      limit: number;
      offset: number;
    },
  ) {
    const where: Prisma.AuditEventWhereInput = {
      tenantId,
      ...(filters.runId ? { runId: filters.runId } : {}),
      ...(filters.operation ? { operation: filters.operation } : {}),
      ...(filters.result ? { result: filters.result } : {}),
      ...(filters.since ? { at: { gte: filters.since } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { at: 'desc' },
        take: filters.limit,
        skip: filters.offset,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return { items, total };
  }

  /** Resumen por operación y resultado, para los gráficos del dashboard. */
  async summary(tenantId: string, since: Date) {
    const rows = await this.prisma.auditEvent.groupBy({
      by: ['operation', 'result'],
      where: { tenantId, at: { gte: since } },
      _count: { _all: true },
      _avg: { durationMs: true },
    });

    return rows.map((row) => ({
      operation: row.operation,
      result: row.result,
      count: row._count._all,
      avgDurationMs: row._avg.durationMs ? Math.round(row._avg.durationMs) : null,
    }));
  }
}
