import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig, SuspConfig } from './configuration';

/**
 * Provee la configuración validada como módulo **global**.
 *
 * Tiene que ser un módulo aparte, y no un provider suelto en `AppModule`: los
 * providers declarados en un módulo no son visibles para los módulos que ese
 * módulo importa. `PrismaService` y `CryptoService` necesitan `CONFIG` y viven
 * en sus propios módulos, así que el token tiene que estar en el ámbito global.
 *
 * La configuración se carga y valida una sola vez, en el arranque: si falta algo
 * esencial o hay una combinación insegura, el proceso no levanta.
 */
@Global()
@Module({
  providers: [
    {
      provide: CONFIG,
      useFactory: (): SuspConfig => loadConfig(),
    },
  ],
  exports: [CONFIG],
})
export class SuspConfigModule {}
