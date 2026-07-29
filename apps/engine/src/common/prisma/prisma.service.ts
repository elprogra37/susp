import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CONFIG, SuspConfig } from '../../config/configuration';

/**
 * Cliente de base de datos.
 *
 * Prisma 7 ya no toma la URL del esquema: el cliente recibe un adaptador de
 * driver. Eso deja el pool de conexiones bajo nuestro control, que es lo que
 * queremos en un proceso que sostiene un scheduler además de la API.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(CONFIG) config: SuspConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        // El scheduler mantiene conexiones tomadas mientras trabaja; el pool
        // tiene que dar lugar a eso y a la API al mismo tiempo.
        max: 20,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      }),
      log:
        config.nodeEnv === 'development'
          ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
          : [{ emit: 'event', level: 'error' }],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conectado a PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Chequeo liviano para `/health/ready`. */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (err) {
      this.logger.error(
        `Falló el ping a la base: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
