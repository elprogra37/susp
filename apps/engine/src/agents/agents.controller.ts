import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { AgentStatus, MemoryKind } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../common/prisma/prisma.service';
import { Principal } from '../common/auth/auth.decorators';
import type { RequestPrincipal } from '../common/auth/auth.types';
import { page, PaginationDto } from '../common/dto/pagination.dto';
import { MemoryService } from './memory.service';

class AgentQueryDto extends PaginationDto {
  @IsOptional() @IsString() campaignId?: string;
  @IsOptional() @IsEnum(AgentStatus) status?: AgentStatus;
}

class MemoryQueryDto extends PaginationDto {
  @IsOptional() @IsEnum(MemoryKind) kind?: MemoryKind;
}

/**
 * Solo lectura: los agentes los crea el planificador a partir de las personas
 * de la campaña. Crearlos a mano rompería la trazabilidad entre persona y agente.
 */
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memory: MemoryService,
  ) {}

  @Get()
  async list(
    @Principal() principal: RequestPrincipal,
    @Query() query: AgentQueryDto,
  ) {
    const where = {
      campaign: { tenantId: principal.tenantId },
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.agent.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: query.limit,
        skip: query.offset,
        include: {
          persona: { select: { id: true, name: true, slug: true } },
          _count: { select: { memories: true, jobs: true } },
        },
      }),
      this.prisma.agent.count({ where }),
    ]);

    return page(items, total, query);
  }

  @Get(':id')
  async get(@Principal() principal: RequestPrincipal, @Param('id') id: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id, campaign: { tenantId: principal.tenantId } },
      include: {
        persona: { select: { id: true, name: true, slug: true } },
        schedules: { orderBy: { startHour: 'asc' } },
        campaign: { select: { id: true, name: true } },
        _count: { select: { memories: true, jobs: true } },
      },
    });
    if (!agent) throw new NotFoundException('No existe ese agente.');
    return agent;
  }

  /**
   * Memoria del agente, con la fuerza ya decaída por el tiempo transcurrido.
   * Es la vista más útil para entender por qué un agente hizo lo que hizo.
   */
  @Get(':id/memories')
  async memories(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Query() query: MemoryQueryDto,
  ) {
    const agent = await this.prisma.agent.findFirst({
      where: { id, campaign: { tenantId: principal.tenantId } },
      select: { id: true },
    });
    if (!agent) throw new NotFoundException('No existe ese agente.');

    const items = await this.memory.recall({
      agentId: id,
      kind: query.kind,
      limit: query.limit,
      // Se muestran también los desvanecidos: para diagnosticar sirve verlos.
      minStrength: 0,
    });

    return { items, total: items.length, limit: query.limit, offset: 0 };
  }
}
