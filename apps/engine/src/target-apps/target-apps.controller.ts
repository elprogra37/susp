import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { Principal, RequireRole } from '../common/auth/auth.decorators';
import type { RequestPrincipal } from '../common/auth/auth.types';
import { Page, page, PaginationDto } from '../common/dto/pagination.dto';
import {
  AllowProductionWritesDto,
  CreateTargetAppDto,
  UpdateTargetAppDto,
} from './target-apps.dto';
import { TargetAppsService, TargetAppView } from './target-apps.service';

@Controller('target-apps')
export class TargetAppsController {
  constructor(private readonly service: TargetAppsService) {}

  @Get()
  async list(
    @Principal() principal: RequestPrincipal,
    @Query() pagination: PaginationDto,
  ): Promise<Page<TargetAppView>> {
    const { items, total } = await this.service.list(
      principal.tenantId,
      pagination.limit,
      pagination.offset,
    );
    return page(items, total, pagination);
  }

  @Get(':id')
  get(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<TargetAppView> {
    return this.service.get(principal.tenantId, id);
  }

  @Post()
  @RequireRole(MemberRole.OPERATOR)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Principal() principal: RequestPrincipal,
    @Body() dto: CreateTargetAppDto,
  ): Promise<TargetAppView> {
    return this.service.create(principal.tenantId, dto);
  }

  @Patch(':id')
  @RequireRole(MemberRole.OPERATOR)
  update(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateTargetAppDto,
  ): Promise<TargetAppView> {
    return this.service.update(principal.tenantId, id, dto);
  }

  @Delete(':id')
  @RequireRole(MemberRole.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<void> {
    return this.service.remove(principal.tenantId, id);
  }

  /** Interroga la app: manifiesto, credenciales y endpoints obligatorios. */
  @Post(':id/health-check')
  @RequireRole(MemberRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  checkHealth(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<TargetAppView> {
    return this.service.checkHealth(principal.tenantId, id);
  }

  /**
   * Habilita o deshabilita escrituras contra una app de producción.
   * Requiere rol OWNER y confirmación explícita: es la salvaguarda más
   * importante del sistema y no debería poder activarse por descuido.
   */
  @Post(':id/production-writes')
  @RequireRole(MemberRole.OWNER)
  @HttpCode(HttpStatus.OK)
  setProductionWrites(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() dto: AllowProductionWritesDto,
  ): Promise<TargetAppView> {
    return this.service.setProductionWrites(principal.tenantId, id, dto);
  }
}
