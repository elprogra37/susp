import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http/http-exception.filter';
import { CONFIG, SuspConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  // Sin `bufferLogs`: si el arranque falla, el error tiene que salir por consola
  // en el acto. Bufferear los logs acá esconde exactamente lo que hace falta ver.
  const app = await NestFactory.create(AppModule);
  const config = app.get<SuspConfig>(CONFIG);
  const logger = new Logger('bootstrap');

  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    origin: process.env.SUSP_CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });

  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');

  logger.log(`SUSP escuchando en http://localhost:${config.port}`);
  logger.log(`Proveedor LLM: ${config.llm.provider}`);

  if (config.safety.dryRun) {
    logger.warn('SUSP_DRY_RUN activo: no se ejecutará ninguna escritura contra las apps destino.');
  }
  if (!config.safety.blockProductionTargets) {
    logger.warn(
      'SUSP_BLOCK_PRODUCTION_TARGETS está en false: el motor PUEDE escribir contra apps de producción.',
    );
  }
}

bootstrap().catch((err: unknown) => {
  // Un fallo de arranque tiene que ser ruidoso y terminar el proceso: un
  // contenedor "arriba" pero sin escuchar es peor que uno caído, porque el
  // orquestador lo da por sano.
  // eslint-disable-next-line no-console
  console.error('SUSP no pudo arrancar:', err);
  process.exit(1);
});
