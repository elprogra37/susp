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
import { MemberRole, Persona, Scenario, Vertical } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { Principal, RequireRole } from '../common/auth/auth.decorators';
import type { RequestPrincipal } from '../common/auth/auth.types';
import { Page, page, PaginationDto } from '../common/dto/pagination.dto';
import {
  CreatePersonaDto,
  CreateScenarioDto,
  UpdatePersonaDto,
  UpdateScenarioDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';

class CatalogQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(Vertical)
  vertical?: Vertical;
}

@Controller('personas')
export class PersonasController {
  constructor(private readonly service: CatalogService) {}

  @Get()
  async list(
    @Principal() principal: RequestPrincipal,
    @Query() query: CatalogQueryDto,
  ): Promise<Page<Persona>> {
    const { items, total } = await this.service.listPersonas(
      principal.tenantId,
      query.limit,
      query.offset,
      query.vertical,
    );
    return page(items, total, query);
  }

  @Get(':id')
  get(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<Persona> {
    return this.service.getPersona(principal.tenantId, id);
  }

  @Post()
  @RequireRole(MemberRole.OPERATOR)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Principal() principal: RequestPrincipal,
    @Body() dto: CreatePersonaDto,
  ): Promise<Persona> {
    return this.service.createPersona(principal.tenantId, dto);
  }

  @Patch(':id')
  @RequireRole(MemberRole.OPERATOR)
  update(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdatePersonaDto,
  ): Promise<Persona> {
    return this.service.updatePersona(principal.tenantId, id, dto);
  }

  @Delete(':id')
  @RequireRole(MemberRole.OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<void> {
    return this.service.removePersona(principal.tenantId, id);
  }
}

@Controller('scenarios')
export class ScenariosController {
  constructor(private readonly service: CatalogService) {}

  @Get()
  async list(
    @Principal() principal: RequestPrincipal,
    @Query() query: CatalogQueryDto,
  ): Promise<Page<Scenario>> {
    const { items, total } = await this.service.listScenarios(
      principal.tenantId,
      query.limit,
      query.offset,
      query.vertical,
    );
    return page(items, total, query);
  }

  @Get(':id')
  get(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<Scenario> {
    return this.service.getScenario(principal.tenantId, id);
  }

  @Post()
  @RequireRole(MemberRole.OPERATOR)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Principal() principal: RequestPrincipal,
    @Body() dto: CreateScenarioDto,
  ): Promise<Scenario> {
    return this.service.createScenario(principal.tenantId, dto);
  }

  @Patch(':id')
  @RequireRole(MemberRole.OPERATOR)
  update(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateScenarioDto,
  ): Promise<Scenario> {
    return this.service.updateScenario(principal.tenantId, id, dto);
  }

  @Delete(':id')
  @RequireRole(MemberRole.OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<void> {
    return this.service.removeScenario(principal.tenantId, id);
  }
}
