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
import { CampaignStatus, MemberRole } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { Principal, RequireRole } from '../common/auth/auth.decorators';
import type { RequestPrincipal } from '../common/auth/auth.types';
import { page, PaginationDto } from '../common/dto/pagination.dto';
import {
  CreateCampaignDto,
  PurgeCampaignDto,
  StartCampaignDto,
  UpdateCampaignDto,
} from './campaigns.dto';
import { CampaignsService } from './campaigns.service';

class CampaignQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;
}

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  @Get()
  async list(
    @Principal() principal: RequestPrincipal,
    @Query() query: CampaignQueryDto,
  ) {
    const { items, total } = await this.service.list(
      principal.tenantId,
      query.limit,
      query.offset,
      query.status,
    );
    return page(items, total, query);
  }

  @Get(':id')
  get(@Principal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.service.get(principal.tenantId, id);
  }

  @Post()
  @RequireRole(MemberRole.OPERATOR)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Principal() principal: RequestPrincipal,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.service.create(principal.tenantId, dto);
  }

  @Patch(':id')
  @RequireRole(MemberRole.OPERATOR)
  update(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.service.update(principal.tenantId, id, dto);
  }

  @Delete(':id')
  @RequireRole(MemberRole.OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Principal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.service.remove(principal.tenantId, id);
  }

  /** Encola una ejecución. El planificador la toma desde ahí. */
  @Post(':id/start')
  @RequireRole(MemberRole.OPERATOR)
  @HttpCode(HttpStatus.ACCEPTED)
  start(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() dto: StartCampaignDto,
  ) {
    return this.service.start(principal.tenantId, id, dto);
  }

  @Post(':id/pause')
  @RequireRole(MemberRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  pause(@Principal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.service.pause(principal.tenantId, id);
  }

  @Post(':id/cancel')
  @RequireRole(MemberRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  cancel(@Principal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.service.cancel(principal.tenantId, id);
  }

  /**
   * Borra en la app destino todo lo generado por esta campaña.
   * Exige rol OWNER y escribir el nombre exacto de la campaña.
   */
  @Post(':id/purge')
  @RequireRole(MemberRole.OWNER)
  @HttpCode(HttpStatus.OK)
  purge(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() dto: PurgeCampaignDto,
  ) {
    return this.service.purge(principal.tenantId, id, dto);
  }
}
