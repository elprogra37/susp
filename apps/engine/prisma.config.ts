/**
 * Configuración de Prisma 7.
 *
 * Desde la versión 7 la URL de conexión ya no va en `schema.prisma`: Migrate la
 * lee de acá, y el cliente en runtime recibe un adaptador (`@prisma/adapter-pg`)
 * construido en `PrismaService`.
 *
 * `datasource` se declara solo si hay `DATABASE_URL` en el entorno. Así
 * `prisma generate` —que no necesita base— funciona sin variables, y los
 * comandos que sí la necesitan (`migrate`, `db pull`) fallan con el mensaje
 * claro de Prisma en vez de intentar conectarse a una URL inventada.
 */
import { defineConfig } from 'prisma/config';

const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(url ? { datasource: { url } } : {}),
  migrations: {
    seed: 'ts-node --transpile-only prisma/seed.ts',
  },
});
