import { Global, Logger, Module } from '@nestjs/common';
import { CONFIG, SuspConfig } from '../config/configuration';
import { AnthropicProvider } from './anthropic.provider';
import { DeterministicProvider } from './deterministic.provider';
import { LLM_PROVIDER, LlmProvider } from './llm.types';

/**
 * Elige el proveedor de lenguaje según la configuración.
 *
 * El default es `deterministic` a propósito: quien clona el repo tiene que poder
 * levantar todo y correr los tests sin conseguir una API key primero.
 */
@Global()
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [CONFIG],
      useFactory: (config: SuspConfig): LlmProvider => {
        const logger = new Logger('LlmModule');

        if (config.llm.provider === 'anthropic') {
          if (!config.llm.anthropicApiKey) {
            // No debería pasar: `loadConfig` ya lo valida. Es una segunda red
            // por si alguien construye la config a mano.
            throw new Error(
              'SUSP_LLM_PROVIDER=anthropic requiere ANTHROPIC_API_KEY.',
            );
          }
          logger.log(
            `Proveedor Anthropic — razonamiento: ${config.llm.reasoningModel}, ` +
              `contenido: ${config.llm.contentModel}`,
          );
          return new AnthropicProvider({
            apiKey: config.llm.anthropicApiKey,
            reasoningModel: config.llm.reasoningModel,
            contentModel: config.llm.contentModel,
          });
        }

        logger.log(
          'Proveedor determinístico: plantillas sembradas, sin API key ni costo.',
        );
        return new DeterministicProvider();
      },
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
