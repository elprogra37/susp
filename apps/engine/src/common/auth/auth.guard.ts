import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { MemberRole, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { PUBLIC_KEY, ROLE_KEY } from './auth.decorators';
import { RequestPrincipal, roleSatisfies } from './auth.types';

/**
 * Acepta dos credenciales:
 *   - `X-Susp-Key: susp_xxxxxxxx_...`  → integraciones y automatización.
 *   - `Authorization: Bearer <jwt>`    → sesión del dashboard.
 *
 * Resuelve el tenant y el rol, y los deja en `request.principal`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const principal =
      (await this.fromApiKey(request)) ?? (await this.fromJwt(request));

    if (!principal) {
      throw new UnauthorizedException(
        'Falta credencial. Usá la cabecera X-Susp-Key o Authorization: Bearer <jwt>.',
      );
    }

    request.principal = principal;

    const requiredRole = this.reflector.getAllAndOverride<MemberRole>(ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRole && !roleSatisfies(principal.role, requiredRole)) {
      throw new ForbiddenException(
        `Esta operación requiere rol ${requiredRole}; tu credencial es ${principal.role}.`,
      );
    }

    return true;
  }

  private async fromApiKey(request: Request): Promise<RequestPrincipal | null> {
    const raw = request.header('x-susp-key');
    if (!raw) return null;

    const prefix = CryptoService.prefixOf(raw);
    if (!prefix) {
      throw new UnauthorizedException('Formato de API key inválido.');
    }

    const record = await this.prisma.apiKey.findUnique({
      where: { prefix },
      include: { tenant: true },
    });

    // Se compara igual aunque no exista, para no revelar por temporización
    // qué prefijos están registrados.
    const expected = record?.hash ?? 'x'.repeat(64);
    const matches = this.crypto.safeEqual(this.crypto.hashApiKey(raw), expected);

    if (!record || !matches) {
      throw new UnauthorizedException('API key inválida.');
    }
    if (record.revokedAt) {
      throw new UnauthorizedException('API key revocada.');
    }
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('API key vencida.');
    }
    if (record.tenant.status !== TenantStatus.ACTIVE) {
      throw new ForbiddenException('El tenant está suspendido.');
    }

    // Registro de uso best-effort: que falle no debe tumbar la petición.
    void this.prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return {
      tenantId: record.tenantId,
      role: record.role,
      kind: 'api-key',
      subjectId: record.id,
      label: record.name,
    };
  }

  private async fromJwt(request: Request): Promise<RequestPrincipal | null> {
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) return null;

    let payload: { sub: string; tenantId: string; role: MemberRole; email: string };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
    } catch {
      throw new UnauthorizedException('Token inválido o vencido.');
    }

    const member = await this.prisma.member.findUnique({
      where: { id: payload.sub },
      include: { tenant: true },
    });
    if (!member) {
      throw new UnauthorizedException('La cuenta ya no existe.');
    }
    if (member.tenant.status !== TenantStatus.ACTIVE) {
      throw new ForbiddenException('El tenant está suspendido.');
    }

    return {
      tenantId: member.tenantId,
      // El rol se lee de la base, no del token: revocar un permiso surte
      // efecto de inmediato sin esperar a que venza el JWT.
      role: member.role,
      kind: 'jwt',
      subjectId: member.id,
      label: member.email,
    };
  }
}
