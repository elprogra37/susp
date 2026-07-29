import type {
  GenerationRequest,
  GenerationResult,
  LlmProvider,
} from './llm.types';
import { SeededRandom } from './seeded-random';
import {
  BIO_APERTURAS,
  BIO_CIERRES,
  BIO_GUSTOS,
  CIERRES_FORMALES,
  CIUDADES,
  COMENTARIOS,
  INTERESES,
  MENSAJES_APERTURA,
  MENSAJES_SEGUIMIENTO,
  MULETILLAS_INFORMALES,
  OBJETOS,
  POSTS_DATING,
  POSTS_MARKETPLACE,
  POSTS_SOCIAL,
  POSTS_TELEMEDICINA,
  PROFESIONES,
  SINTOMAS,
} from './corpus';

/**
 * Proveedor sin LLM: arma texto plausible con plantillas sembradas.
 *
 * Existe para que **todo el sistema corra y se testee sin API key**. Es el
 * proveedor por defecto y el que usa la CI: gratis, instantáneo y reproducible
 * — la misma semilla da siempre el mismo texto, así que un bug de simulación se
 * puede reproducir exactamente.
 *
 * No compite con un modelo en calidad. Compite en costo y determinismo, que para
 * llenar una demo o correr una prueba de carga suele ser lo que importa.
 */
export class DeterministicProvider implements LlmProvider {
  readonly name = 'deterministic';

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const startedAt = Date.now();
    const rng = new SeededRandom(
      `${request.seed ?? 'sin-semilla'}:${request.purpose}:${request.prompt.length}`,
    );

    const text = this.render(request, rng);

    return {
      text,
      model: 'plantillas-sembradas-v1',
      provider: this.name,
      durationMs: Date.now() - startedAt,
    };
  }

  private render(request: GenerationRequest, rng: SeededRandom): string {
    const vertical = this.readTag(request, 'vertical');
    const tone = this.readTone(request);

    switch (request.purpose) {
      case 'profile':
        return this.bio(rng, tone);
      case 'content':
        return this.post(rng, vertical, tone);
      case 'message':
        return this.message(rng, tone, this.readTag(request, 'kind'));
      case 'decision':
      case 'reasoning':
      default:
        // Para razonar no se inventa prosa: se devuelve una decisión estructurada
        // que el motor puede parsear igual que la de un modelo real.
        return this.decision(rng, request);
    }
  }

  // ─────────────────────────────── piezas ───────────────────────────────

  private bio(rng: SeededRandom, tone: Tone): string {
    const profesion = rng.pick(PROFESIONES);
    const ciudad = rng.pick(CIUDADES).city;
    const [interes, interes2] = rng.sample(INTERESES, 2);

    const partes = [
      this.fill(rng.pick(BIO_APERTURAS), { profesion, ciudad, interes, interes2 }),
      this.fill(rng.pick(BIO_GUSTOS), { profesion, ciudad, interes, interes2 }),
    ];

    // Cuánto escribe depende del rasgo, no del azar: un agente parco es parco
    // siempre, y eso es lo que lo hace creíble a lo largo de una simulación.
    if (tone.chattiness > 0.55) partes.push(rng.pick(BIO_CIERRES));
    if (tone.chattiness > 0.85) partes.push(rng.pick(BIO_CIERRES));

    return this.applyTone(partes.join(' '), rng, tone);
  }

  private post(rng: SeededRandom, vertical: string | undefined, tone: Tone): string {
    const bank =
      vertical === 'dating'
        ? POSTS_DATING
        : vertical === 'marketplace'
          ? POSTS_MARKETPLACE
          : vertical === 'telemedicine'
            ? POSTS_TELEMEDICINA
            : POSTS_SOCIAL;

    const [interes, interes2] = rng.sample(INTERESES, 2);
    const text = this.fill(rng.pick(bank), {
      interes,
      interes2,
      ciudad: rng.pick(CIUDADES).city,
      profesion: rng.pick(PROFESIONES),
      objeto: rng.pick(OBJETOS),
      sintoma: rng.pick(SINTOMAS),
    });

    return this.applyTone(text, rng, tone);
  }

  private message(rng: SeededRandom, tone: Tone, kind: string | undefined): string {
    if (kind === 'comment') {
      return this.applyTone(rng.pick(COMENTARIOS), rng, tone);
    }

    const bank = kind === 'opener' ? MENSAJES_APERTURA : MENSAJES_SEGUIMIENTO;
    const text = this.fill(rng.pick(bank), {
      interes: rng.pick(INTERESES),
      ciudad: rng.pick(CIUDADES).city,
    });

    // Un agente muy conversador encadena dos frases; uno parco manda una sola.
    if (tone.chattiness > 0.75 && rng.bool(0.5)) {
      return this.applyTone(`${text} ${rng.pick(MENSAJES_SEGUIMIENTO)}`, rng, tone);
    }
    return this.applyTone(text, rng, tone);
  }

  /**
   * Decisión estructurada. Devuelve JSON para que el motor lea la salida del
   * proveedor determinístico exactamente igual que la de Claude.
   */
  private decision(rng: SeededRandom, request: GenerationRequest): string {
    const options = this.readOptions(request);
    const chosen = options.length > 0 ? rng.pick(options) : 'skip';
    return JSON.stringify({
      action: chosen,
      confidence: Number(rng.float(0.55, 0.95).toFixed(2)),
      reason: 'Elección sembrada del proveedor determinístico.',
    });
  }

  // ─────────────────────────────── utilidades ───────────────────────────────

  private fill(template: string, values: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
  }

  /**
   * Ajusta el texto a la personalidad. La variedad entre agentes sale de acá y
   * de la semilla, no de un parámetro de sampling — que además ya no existe en
   * los modelos Opus 5.
   */
  private applyTone(text: string, rng: SeededRandom, tone: Tone): string {
    let result = text;

    if (tone.formality < 0.3 && rng.bool(0.35)) {
      result = `${rng.pick(MULETILLAS_INFORMALES)}, ${lowerFirst(result)}`;
    }
    if (tone.formality > 0.75 && rng.bool(0.4)) {
      result = `${result} ${rng.pick(CIERRES_FORMALES)}`;
    }
    if (tone.extraversion > 0.8 && rng.bool(0.3)) {
      result = result.replace(/\.$/, '!');
    }

    return result.trim();
  }

  private readTone(request: GenerationRequest): Tone {
    return {
      chattiness: this.readNumberTag(request, 'chattiness', 0.5),
      formality: this.readNumberTag(request, 'formality', 0.5),
      extraversion: this.readNumberTag(request, 'extraversion', 0.5),
    };
  }

  private readTag(request: GenerationRequest, key: string): string | undefined {
    return request.tags?.[key];
  }

  private readNumberTag(
    request: GenerationRequest,
    key: string,
    fallback: number,
  ): number {
    const raw = request.tags?.[key];
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  /** Las opciones de una decisión viajan en el tag `options`, separadas por coma. */
  private readOptions(request: GenerationRequest): string[] {
    const raw = request.tags?.options;
    if (!raw) return [];
    return raw
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean);
  }
}

interface Tone {
  chattiness: number;
  formality: number;
  extraversion: number;
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0].toLowerCase() + text.slice(1);
}
