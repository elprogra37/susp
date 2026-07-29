import { DeterministicProvider } from './deterministic.provider';
import type { GenerationRequest } from './llm.types';

const base: GenerationRequest = {
  purpose: 'content',
  system: 'Sos un usuario sintético.',
  prompt: 'Escribí una publicación.',
  seed: 'agente-1',
  locale: 'es-AR',
};

describe('DeterministicProvider', () => {
  const provider = new DeterministicProvider();

  it('no necesita API key ni red', async () => {
    const result = await provider.generate(base);
    expect(result.provider).toBe('deterministic');
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('la misma semilla da el mismo texto', async () => {
    const a = await provider.generate(base);
    const b = await provider.generate(base);
    expect(a.text).toBe(b.text);
  });

  it('genera variedad suficiente entre agentes distintos', async () => {
    // La garantía no es que dos semillas cualesquiera difieran —con un banco de
    // plantillas finito, coincidir de a dos es esperable y no es un error—, sino
    // que una población de agentes no escriba todos lo mismo. Eso es lo que hace
    // creíble un feed poblado, y es lo que se mide acá.
    const textos = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const result = await provider.generate({ ...base, seed: `agente-${i}` });
      textos.add(result.text);
    }
    expect(textos.size).toBeGreaterThan(20);
  });

  it('no deja marcadores de plantilla sin reemplazar', async () => {
    for (let i = 0; i < 40; i++) {
      const result = await provider.generate({ ...base, seed: `semilla-${i}` });
      expect(result.text).not.toMatch(/\{\w+\}/);
    }
  });

  describe('adaptación al vertical', () => {
    it('un marketplace habla de vender, no de publicar en el feed', async () => {
      const textos: string[] = [];
      for (let i = 0; i < 12; i++) {
        const result = await provider.generate({
          ...base,
          seed: `mk-${i}`,
          tags: { vertical: 'marketplace' },
        });
        textos.push(result.text.toLowerCase());
      }
      const comercial = textos.filter((t) =>
        /vendo|liquido|cambio|impecable|nuevo/.test(t),
      );
      expect(comercial.length).toBeGreaterThan(textos.length / 2);
    });

    it('telemedicina genera consultas', async () => {
      const textos: string[] = [];
      for (let i = 0; i < 12; i++) {
        const result = await provider.generate({
          ...base,
          seed: `tm-${i}`,
          tags: { vertical: 'telemedicine' },
        });
        textos.push(result.text.toLowerCase());
      }
      const clinico = textos.filter((t) =>
        /consulta|receta|control|tratamiento|estudios/.test(t),
      );
      expect(clinico.length).toBeGreaterThan(textos.length / 2);
    });
  });

  describe('personalidad', () => {
    it('un agente muy informal usa muletillas rioplatenses', async () => {
      const textos: string[] = [];
      for (let i = 0; i < 30; i++) {
        const result = await provider.generate({
          ...base,
          seed: `inf-${i}`,
          tags: { formality: '0.05', chattiness: '0.9', extraversion: '0.5' },
        });
        textos.push(result.text.toLowerCase());
      }
      expect(textos.some((t) => /^(che|posta|la verdad|obvio),/.test(t))).toBe(true);
    });

    it('un agente muy formal cierra con fórmulas de cortesía', async () => {
      const textos: string[] = [];
      for (let i = 0; i < 30; i++) {
        const result = await provider.generate({
          ...base,
          seed: `for-${i}`,
          tags: { formality: '0.95', chattiness: '0.5', extraversion: '0.2' },
        });
        textos.push(result.text);
      }
      expect(
        textos.some((t) => /Saludos cordiales|Quedo a disposición|Muchas gracias/.test(t)),
      ).toBe(true);
    });

    it('la verbosidad de la biografía sigue al rasgo, no al azar', async () => {
      const parco = await provider.generate({
        ...base,
        purpose: 'profile',
        seed: 'bio-igual',
        tags: { chattiness: '0.1' },
      });
      const charlatan = await provider.generate({
        ...base,
        purpose: 'profile',
        seed: 'bio-igual',
        tags: { chattiness: '0.95' },
      });
      expect(charlatan.text.length).toBeGreaterThan(parco.text.length);
    });
  });

  describe('decisiones', () => {
    it('devuelve JSON parseable, igual que un modelo real', async () => {
      const result = await provider.generate({
        ...base,
        purpose: 'decision',
        tags: { options: 'content.create,interactions.create,messaging.send' },
      });
      const parsed = JSON.parse(result.text) as { action: string; confidence: number };
      expect(['content.create', 'interactions.create', 'messaging.send']).toContain(
        parsed.action,
      );
      expect(parsed.confidence).toBeGreaterThan(0);
      expect(parsed.confidence).toBeLessThanOrEqual(1);
    });

    it('sin opciones devuelve skip en vez de romper', async () => {
      const result = await provider.generate({ ...base, purpose: 'decision' });
      expect(JSON.parse(result.text)).toMatchObject({ action: 'skip' });
    });
  });

  describe('mensajería', () => {
    it('distingue un primer mensaje de una respuesta', async () => {
      const opener = await provider.generate({
        ...base,
        purpose: 'message',
        seed: 'msg-1',
        tags: { kind: 'opener' },
      });
      const followup = await provider.generate({
        ...base,
        purpose: 'message',
        seed: 'msg-1',
        tags: { kind: 'followup' },
      });
      expect(opener.text).not.toBe(followup.text);
    });
  });
});
