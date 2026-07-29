/**
 * Siembra la identidad mínima para poder usar el motor: un tenant, un usuario
 * dueño y una API key.
 *
 * Es idempotente: se puede correr las veces que haga falta. El catálogo de
 * personas y escenarios lo siembra por separado `@susp/personas` (Fase 7).
 */

import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { MemberRole, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Falta DATABASE_URL. Ver .env.example.');
  process.exit(1);
}

// Prisma 7 pide adaptador de driver: la URL ya no sale del esquema.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function hashPassword(plaintext: string): string {
  const salt = randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const derived = scryptSync(plaintext, salt, 64, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), derived.toString('base64')].join('$');
}

function buildApiKey(explicit?: string): {
  plaintext: string;
  prefix: string;
  hash: string;
} {
  // Si viene una clave de bootstrap por entorno se respeta, siempre que tenga
  // el formato esperado; si no, se genera una nueva.
  if (explicit) {
    const match = /^(susp_[0-9a-f]{8})_/.exec(explicit);
    if (match) {
      return {
        plaintext: explicit,
        prefix: match[1],
        hash: createHash('sha256').update(explicit).digest('hex'),
      };
    }
    console.warn(
      '⚠  SUSP_BOOTSTRAP_API_KEY no tiene el formato susp_xxxxxxxx_...; se genera una nueva.',
    );
  }

  const prefix = `susp_${randomBytes(4).toString('hex')}`;
  const plaintext = `${prefix}_${randomBytes(24).toString('base64url')}`;
  return {
    plaintext,
    prefix,
    hash: createHash('sha256').update(plaintext).digest('hex'),
  };
}

async function main(): Promise<void> {
  const slug = process.env.SUSP_BOOTSTRAP_TENANT ?? 'default';
  const email = (process.env.SUSP_BOOTSTRAP_EMAIL ?? 'admin@susp.local').toLowerCase();
  const password = process.env.SUSP_BOOTSTRAP_PASSWORD ?? 'susp-admin-2026';

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: {},
    create: { slug, name: process.env.SUSP_BOOTSTRAP_TENANT_NAME ?? 'Tenant por defecto' },
  });
  console.log(`✓ Tenant "${tenant.name}" (${tenant.slug})`);

  const existingMember = await prisma.member.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
  });

  if (existingMember) {
    console.log(`✓ Usuario ${email} ya existía (no se toca la contraseña)`);
  } else {
    await prisma.member.create({
      data: {
        tenantId: tenant.id,
        email,
        passwordHash: hashPassword(password),
        role: MemberRole.OWNER,
      },
    });
    console.log(`✓ Usuario ${email} creado con rol OWNER`);
    if (!process.env.SUSP_BOOTSTRAP_PASSWORD) {
      console.log(`  Contraseña por defecto: ${password}  ← cambiala antes de exponer el motor`);
    }
  }

  const existingKey = await prisma.apiKey.findFirst({
    where: { tenantId: tenant.id, name: 'bootstrap', revokedAt: null },
  });

  if (existingKey) {
    console.log(`✓ API key de bootstrap ya existía (prefijo ${existingKey.prefix})`);
  } else {
    const key = buildApiKey(process.env.SUSP_BOOTSTRAP_API_KEY);
    await prisma.apiKey.create({
      data: {
        tenantId: tenant.id,
        name: 'bootstrap',
        prefix: key.prefix,
        hash: key.hash,
        role: MemberRole.OWNER,
      },
    });
    console.log('✓ API key de bootstrap creada:');
    console.log(`\n    ${key.plaintext}\n`);
    console.log('  Guardala ahora: solo queda el hash, no se vuelve a mostrar.');
  }

  console.log('\nListo. Probá:  curl -H "X-Susp-Key: <clave>" http://localhost:55701/api/v1/tenant');
}

main()
  .catch((err: unknown) => {
    console.error('La siembra falló:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
