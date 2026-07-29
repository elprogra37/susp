import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { Principal, Public } from '../common/auth/auth.decorators';
import type { RequestPrincipal } from '../common/auth/auth.types';
import { UnauthorizedException } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';

export class LoginDto {
  @IsEmail({}, { message: 'El email no es válido.' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña tiene al menos 8 caracteres.' })
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
  ) {}

  /** Sesión del dashboard. Las integraciones usan API key, no esto. */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<{
    token: string;
    expiresIn: number;
    tenant: { id: string; name: string; slug: string };
    member: { id: string; email: string; role: string };
  }> {
    const member = await this.prisma.member.findFirst({
      where: { email: dto.email.toLowerCase() },
      include: { tenant: true },
    });

    // Se verifica siempre contra un hash, exista o no la cuenta, para que el
    // tiempo de respuesta no revele qué emails están registrados.
    const stored = member?.passwordHash ?? this.crypto.hashPassword('__inexistente__');
    const ok = this.crypto.verifyPassword(dto.password, stored);

    if (!member || !ok) {
      throw new UnauthorizedException('Email o contraseña incorrectos.');
    }
    if (member.tenant.status !== TenantStatus.ACTIVE) {
      throw new UnauthorizedException('El tenant está suspendido.');
    }

    const expiresIn = 60 * 60 * 12;
    const token = await this.jwt.signAsync(
      {
        sub: member.id,
        tenantId: member.tenantId,
        role: member.role,
        email: member.email,
      },
      { expiresIn },
    );

    return {
      token,
      expiresIn,
      tenant: {
        id: member.tenant.id,
        name: member.tenant.name,
        slug: member.tenant.slug,
      },
      member: { id: member.id, email: member.email, role: member.role },
    };
  }

  /** Quién soy: sirve para que el dashboard valide su sesión al arrancar. */
  @Get('me')
  me(@Principal() principal: RequestPrincipal): RequestPrincipal {
    return principal;
  }
}
