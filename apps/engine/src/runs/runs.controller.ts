import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { JobStatus, RunStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../common/prisma/prisma.service';
import { Principal } from '../common/auth/auth.decorators';
import type { RequestPrincipal } from '../common/auth/auth.types';
import { page, PaginationDto } from '../common/dto/pagination.dto';

class RunQueryDto extends PaginationDto {
  @IsOptional() @IsString() campaignId?: string;
  @IsOptional() @IsEnum(RunStatus) status?: RunStatus;
}

class JobQueryDto extends PaginationDto {
  @IsOptional() @IsEnum(JobStatus) status?: JobStatus;
  @IsOptional() @IsString() operation?: string;
}

/** Solo lectura: las ejecuciones se crean desde la campaña y las mueve el scheduler. */
@Controller('runs')
export class RunsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Principal() principal: RequestPrincipal,
    @Query() query: RunQueryDto,
  ) {
    const where = {
      campaign: { tenantId: principal.tenantId },
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.run.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
        include: {
          campaign: { select: { id: true, name: true, targetAppId: true } },
        },
      }),
      this.prisma.run.count({ where }),
    ]);

    return page(items, total, query);
  }

  @Get(':id')
  async get(@Principal() principal: RequestPrincipal, @Param('id') id: string) {
    const run = await this.prisma.run.findFirst({
      where: { id, campaign: { tenantId: principal.tenantId } },
      include: {
        campaign: { select: { id: true, name: true, targetApp: { select: { name: true, slug: true } } } },
        _count: { select: { jobs: true, entities: true } },
      },
    });
    if (!run) throw new NotFoundException('No existe esa ejecución.');

    const [byStatus, byOperation] = await Promise.all([
      this.prisma.job.groupBy({
        by: ['status'],
        where: { runId: id },
        _count: { _all: true },
      }),
      this.prisma.job.groupBy({
        by: ['operation'],
        where: { runId: id },
        _count: { _all: true },
        _avg: { durationMs: true },
      }),
    ]);

    return {
      ...run,
      jobsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      jobsByOperation: byOperation.map((r) => ({
        operation: r.operation,
        count: r._count._all,
        avgDurationMs: r._avg.durationMs ? Math.round(r._avg.durationMs) : null,
      })),
    };
  }

  @Get(':id/jobs')
  async jobs(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Query() query: JobQueryDto,
  ) {
    const run = await this.prisma.run.findFirst({
      where: { id, campaign: { tenantId: principal.tenantId } },
      select: { id: true },
    });
    if (!run) throw new NotFoundException('No existe esa ejecución.');

    const where = {
      runId: id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.operation ? { operation: query.operation } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }],
        take: query.limit,
        skip: query.offset,
        include: {
          agent: { select: { id: true, displayName: true, handle: true } },
        },
      }),
      this.prisma.job.count({ where }),
    ]);

    return page(items, total, query);
  }

  /** Entidades sintéticas creadas por esta ejecución en la app destino. */
  @Get(':id/entities')
  async entities(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Query() query: PaginationDto,
  ) {
    const run = await this.prisma.run.findFirst({
      where: { id, campaign: { tenantId: principal.tenantId } },
      select: { id: true },
    });
    if (!run) throw new NotFoundException('No existe esa ejecución.');

    const where = { runId: id };
    const [items, total] = await Promise.all([
      this.prisma.syntheticEntity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.syntheticEntity.count({ where }),
    ]);

    return page(items, total, query);
  }
}
