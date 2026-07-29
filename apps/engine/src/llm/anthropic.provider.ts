import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import type {
  GenerationPurpose,
  GenerationRequest,
  GenerationResult,
  LlmProvider,
} from './llm.types';

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  /** Modelo para planificar y decidir. */
  readonly reasoningModel: string;
  /** Modelo para generar contenido en volumen. */
  readonly contentModel: string;
}

/**
 * Proveedor Anthropic.
 *
 * Dos detalles de la API que importan y son fáciles de arruinar:
 *
 * 1. **`temperature` / `top_p` / `top_k` fueron eliminados de la familia Opus 5.**
 *    Enviarlos devuelve `400`. La variedad entre agentes no sale del sampling:
 *    sale de la personalidad y de la semilla, que viajan en el prompt. Solo se
 *    envía `temperature` a modelos que todavía la aceptan.
 *
 * 2. **`stop_reason: "refusal"` llega como HTTP 200.** Hay que revisarlo *antes*
 *    de leer `content`, porque en una negativa el array viene vacío y
 *    `content[0].text` rompería.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const startedAt = Date.now();
    const model = this.modelFor(request.purpose);
    const deepThinking =
      request.purpose === 'reasoning' || request.purpose === 'decision';

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens(request.purpose),
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
      // Generar el texto de un posteo sintético no necesita razonamiento profundo;
      // planificar la conducta de un agente, sí.
      output_config: { effort: deepThinking ? 'medium' : 'low' },
      // Solo los modelos que aún aceptan sampling reciben `temperature`.
      // En la familia Opus 5 este parámetro es un 400 seguro.
      ...(this.acceptsSampling(model) ? { temperature: 1 } : {}),
    };

    try {
      const response = await this.client.messages.create(params);

      // Chequear ANTES de tocar `content`: en una negativa viene vacío.
      if (response.stop_reason === 'refusal') {
        const category = response.stop_details?.category ?? null;
        this.logger.warn(
          `El modelo declinó generar (categoría: ${category ?? 'sin especificar'}). Se omite la acción.`,
        );
        return {
          text: '',
          model,
          provider: this.name,
          durationMs: Date.now() - startedAt,
          refused: true,
          refusalCategory: category,
        };
      }

      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim();

      return {
        text,
        model,
        provider: this.name,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      this.logger.error(
        `Falló la generación con ${model}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  private modelFor(purpose: GenerationPurpose): string {
    return purpose === 'reasoning' || purpose === 'decision'
      ? this.options.reasoningModel
      : this.options.contentModel;
  }

  private defaultMaxTokens(purpose: GenerationPurpose): number {
    switch (purpose) {
      case 'reasoning':
      case 'decision':
        return 2048;
      case 'profile':
        return 1024;
      case 'message':
        return 512;
      case 'content':
      default:
        return 768;
    }
  }

  /**
   * A partir de Opus 4.7 los parámetros de sampling fueron eliminados y
   * devuelven 400. Haiku 4.5 y los Claude 3.x todavía los aceptan.
   */
  private acceptsSampling(model: string): boolean {
    return /^claude-haiku-4-5/.test(model) || /^claude-3/.test(model);
  }
}
