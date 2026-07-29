/**
 * Prepara la base de pruebas antes de correr los e2e.
 *
 * Se usa una base **aparte** (`susp_test`), no un schema dentro de la de
 * desarrollo: los e2e truncan tablas entre casos, y hacer eso sobre la base de
 * trabajo sería una forma rápida de perder los datos de una demo a medio armar.
 */

import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

const BASE_ADMIN =
  process.env.E2E_ADMIN_URL ?? 'postgresql://susp:susp_local_dev@postgres:5432/postgres';
const BASE_TEST =
  process.env.E2E_DATABASE_URL ?? 'postgresql://susp:susp_local_dev@postgres:5432/susp_test';

export default async function globalSetup(): Promise<void> {
  const admin = new Client({ connectionString: BASE_ADMIN });
  await admin.connect();

  try {
    const existe = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      ['susp_test'],
    );
    if (existe.rowCount === 0) {
      // No se puede parametrizar el nombre en un CREATE DATABASE; el valor es
      // una constante del propio archivo, no entrada de usuario.
      await admin.query('CREATE DATABASE susp_test');
      console.log('  base de pruebas susp_test creada');
    }
  } finally {
    await admin.end();
  }

  // Migraciones sobre la base de pruebas. `migrate deploy` es idempotente.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: BASE_TEST },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = BASE_TEST;
  process.env.NODE_ENV = 'test';
  // Los e2e no deben depender de una API key ni gastar tokens.
  process.env.SUSP_LLM_PROVIDER = 'deterministic';
  // El scheduler se apaga: cada caso controla cuándo avanza la simulación.
  // Con él encendido, los tests competirían con un bucle de fondo.
  process.env.SUSP_SCHEDULER_ENABLED = 'false';
  process.env.JWT_SECRET ??= 'secreto-de-pruebas-suficientemente-largo-1234567890';
}
