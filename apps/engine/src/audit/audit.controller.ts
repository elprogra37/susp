import { Controller, Get, Query } from '@nestjs/common';
import { AuditEvent, AuditResult } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Principal } from '../common/auth/auth.decorators';
import type { RequestPrincipal } from '../common/auth/auth.types';
import { Page, page, PaginationDto } from '../common/dto/pagination.dto';
import { AuditService } from './audit.service';

class AuditQueryDto extends PaginationDto {
  @IsOptional() @IsString() runId?: string;
  @IsOptional() @IsString() operation?: string;
  @IsOptional() @IsEnum(AuditResult) result?: AuditResult;
  @IsOptional() @IsDateString() since?: string;
}

class SummaryQueryDto {
  /** Ventana hacia atrás, en horas. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24 * 90)
  hours = 24;
}

@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  async list(
    @Principal() principal: RequestPrincipal,
    @Query() query: AuditQueryDto,
  ): Promise<Page<AuditEvent>> {
    const { items, total } = await this.service.list(principal.tenantId, {
      runId: query.runId,
      operation: query.operation,
      result: query.result,
      since: query.since ? new Date(query.since) : undefined,
      limit: query.limit,
      offset: query.offset,
    });
    return page(items, total, query);
  }

  @Get('summary')
  summary(
    @Principal() principal: RequestPrincipal,
    @Query() query: SummaryQueryDto,
  ) {
    const since = new Date(Date.now() - query.hours * 3_600_000);
    return this.service.summary(principal.tenantId, since);
  }
}
