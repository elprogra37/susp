import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { Principal, RequireRole } from '../common/auth/auth.decorators';
import type { RequestPrincipal } from '../common/auth/auth.types';
import { Page, page, PaginationDto } from '../common/dto/pagination.dto';

export class CreateApiKeyDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsEnum(MemberRole)
  role: MemberRole = MemberRole.OPERATOR;

  /** Días de validez. Sin valor, no vence. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}

interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  role: MemberRole;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

@Controller('tenant')
export class TenantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Datos del tenant de la credencial en uso. No hay acceso cruzado entre tenants. */
  @Get()
  async current(@Principal() principal: RequestPrincipal) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: principal.tenantId },
      include: {
        _count: {
          select: { targetApps: true, campaigns: true, personas: true, scenarios: true },
        },
      },
    });
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      createdAt: tenant.createdAt,
      counts: tenant._count,
    };
  }

  @Get('api-keys')
  @RequireRole(MemberRole.OWNER)
  async listKeys(
    @Principal() principal: RequestPrincipal,
    @Query() pagination: PaginationDto,
  ): Promise<Page<ApiKeyView>> {
    const where = { tenantId: principal.tenantId };
    const [items, total] = await Promise.all([
      this.prisma.apiKey.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pagination.limit,
        skip: pagination.offset,
        // El hash nunca sale de la base.
        select: {
          id: true,
          name: true,
          prefix: true,
          role: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.apiKey.count({ where }),
    ]);
    return page(items, total, pagination);
  }

  /**
   * Crea una API key. El valor en claro se devuelve **una sola vez**: después
   * solo queda su hash, así que no hay forma de recuperarlo.
   */
  @Post('api-keys')
  @RequireRole(MemberRole.OWNER)
  @HttpCode(HttpStatus.CREATED)
  async createKey(
    @Principal() principal: RequestPrincipal,
    @Body() dto: CreateApiKeyDto,
  ): Promise<ApiKeyView & { key: string; warning: string }> {
    const { plaintext, prefix, hash } = this.crypto.generateApiKey();
    const expiresAt = dto.expiresInDays
      ? new Date(Date.now() + dto.expiresInDays * 86_400_000)
      : null;

    const created = await this.prisma.apiKey.create({
      data: {
        tenantId: principal.tenantId,
        name: dto.name,
        prefix,
        hash,
        role: dto.role,
        expiresAt,
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        role: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    return {
      ...created,
      key: plaintext,
      warning: 'Guardala ahora: esta clave no se vuelve a mostrar.',
    };
  }

  @Delete('api-keys/:id')
  @RequireRole(MemberRole.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeKey(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<void> {
    // El where compuesto impide revocar claves de otro tenant.
    await this.prisma.apiKey.update({
      where: { id, tenantId: principal.tenantId },
      data: { revokedAt: new Date() },
    });
  }
}
