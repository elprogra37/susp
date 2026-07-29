import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes } from 'node:crypto';
import { MemberRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';

export interface Contexto {
  app: INestApplication;
  prisma: PrismaService;
  tenantId: string;
  /** API key en claro, para las cabeceras. */
  apiKey: string;
  /** Credenciales del usuario dueño, para probar el login. */
  email: string;
  password: string;
  cerrar: () => Promise<void>;
}

/**
 * Levanta la app completa contra la base de pruebas y siembra un tenant.
 *
 * Se monta el `AppModule` de verdad, con sus guards y su filtro de errores: un
 * e2e que monta una versión recortada de la app prueba una app que no existe.
 */
export async function levantarApp(): Promise<Contexto> {
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = modulo.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();

  const prisma = app.get(PrismaService);
  await limpiar(prisma);

  const sufijo = randomBytes(4).toString('hex');
  const tenant = await prisma.tenant.create({
    data: { name: 'Tenant de pruebas', slug: `pruebas-${sufijo}` },
  });

  const prefix = `susp_${randomBytes(4).toString('hex')}`;
  const apiKey = `${prefix}_${randomBytes(24).toString('base64url')}`;
  await prisma.apiKey.create({
    data: {
      tenantId: tenant.id,
      name: 'e2e',
      prefix,
      hash: createHash('sha256').update(apiKey).digest('hex'),
      role: MemberRole.OWNER,
    },
  });

  const email = `duenio-${sufijo}@pruebas.local`;
  const password = 'contraseña-de-pruebas-larga';
  const crypto = app.get<{ hashPassword(p: string): string }>(
    // Se toma el servicio real para que el hash sea el mismo que produce la app.
    (await import('../src/common/crypto/crypto.service')).CryptoService,
  );
  await prisma.member.create({
    data: {
      tenantId: tenant.id,
      email,
      passwordHash: crypto.hashPassword(password),
      role: MemberRole.OWNER,
    },
  });

  return {
    app,
    prisma,
    tenantId: tenant.id,
    apiKey,
    email,
    password,
    cerrar: async () => {
      await limpiar(prisma);
      await app.close();
    },
  };
}

/**
 * Vacía las tablas respetando las dependencias.
 *
 * `TRUNCATE ... CASCADE` en una sola sentencia evita tener que ordenar a mano y
 * es mucho más rápido que borrar fila por fila entre casos.
 */
export async function limpiar(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_events", "synthetic_entities", "jobs", "runs",
      "agent_memories", "agent_schedules", "agents",
      "campaigns", "scenarios", "personas",
      "usi_credentials", "target_apps",
      "api_keys", "members", "tenants"
    RESTART IDENTITY CASCADE
  `);
}

/** Cabeceras con la API key del tenant de pruebas. */
export function conClave(ctx: Contexto): Record<string, string> {
  return { 'X-Susp-Key': ctx.apiKey };
}
