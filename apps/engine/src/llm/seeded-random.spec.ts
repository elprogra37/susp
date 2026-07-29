import { SeededRandom } from './seeded-random';

describe('SeededRandom', () => {
  describe('reproducibilidad', () => {
    it('la misma semilla produce la misma secuencia', () => {
      const a = new SeededRandom('agente-7');
      const b = new SeededRandom('agente-7');
      const seqA = Array.from({ length: 20 }, () => a.next());
      const seqB = Array.from({ length: 20 }, () => b.next());
      expect(seqA).toEqual(seqB);
    });

    it('semillas distintas producen secuencias distintas', () => {
      const a = new SeededRandom('agente-7');
      const b = new SeededRandom('agente-8');
      expect(a.next()).not.toBe(b.next());
    });

    it('acepta semilla numérica', () => {
      const a = new SeededRandom(12345);
      const b = new SeededRandom(12345);
      expect(a.next()).toBe(b.next());
    });

    it('derive aísla subsistemas: cada etiqueta tiene su propia secuencia', () => {
      const base = new SeededRandom('campaña');
      const uno = base.derive('perfil').next();
      const otro = new SeededRandom('campaña').derive('horario').next();
      expect(uno).not.toBe(otro);
    });
  });

  describe('rangos', () => {
    it('next queda en [0, 1)', () => {
      const rng = new SeededRandom('rango');
      for (let i = 0; i < 500; i++) {
        const value = rng.next();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });

    it('int incluye ambos extremos', () => {
      const rng = new SeededRandom('enteros');
      const seen = new Set<number>();
      for (let i = 0; i < 500; i++) seen.add(rng.int(1, 3));
      expect([...seen].sort()).toEqual([1, 2, 3]);
    });

    it('normal respeta los límites', () => {
      const rng = new SeededRandom('normal');
      for (let i = 0; i < 500; i++) {
        const value = rng.normal(0.5, 0.5, 0, 1);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('selección', () => {
    it('pick devuelve un elemento de la lista', () => {
      const rng = new SeededRandom('pick');
      const items = ['a', 'b', 'c'];
      for (let i = 0; i < 50; i++) expect(items).toContain(rng.pick(items));
    });

    it('pick sobre lista vacía falla con un mensaje claro', () => {
      expect(() => new SeededRandom('x').pick([])).toThrow(/lista vacía/);
    });

    it('sample no repite elementos', () => {
      const rng = new SeededRandom('sample');
      const result = rng.sample(['a', 'b', 'c', 'd', 'e'], 3);
      expect(result).toHaveLength(3);
      expect(new Set(result).size).toBe(3);
    });

    it('sample devuelve todo si se piden más de los que hay', () => {
      const rng = new SeededRandom('sample2');
      expect(rng.sample(['a', 'b'], 10)).toHaveLength(2);
    });

    it('shuffle no muta el original', () => {
      const rng = new SeededRandom('shuffle');
      const original = ['a', 'b', 'c', 'd'];
      const copy = [...original];
      rng.shuffle(original);
      expect(original).toEqual(copy);
    });
  });

  describe('elección ponderada', () => {
    it('respeta los pesos de forma aproximada', () => {
      const rng = new SeededRandom('pesos');
      const counts: Record<string, number> = { raro: 0, comun: 0 };
      for (let i = 0; i < 4000; i++) {
        counts[rng.weighted({ raro: 1, comun: 9 })] += 1;
      }
      // 1:9 debería dar algo cercano a 400 : 3600. Se deja margen amplio para
      // que el test no sea frágil, pero sí detecte una inversión de pesos.
      expect(counts.comun).toBeGreaterThan(counts.raro * 5);
    });

    it('ignora las opciones con peso cero', () => {
      const rng = new SeededRandom('cero');
      for (let i = 0; i < 100; i++) {
        expect(rng.weighted({ nunca: 0, siempre: 1 })).toBe('siempre');
      }
    });

    it('falla si ninguna opción tiene peso', () => {
      expect(() => new SeededRandom('x').weighted({ a: 0, b: 0 })).toThrow(
        /peso mayor a cero/,
      );
    });
  });
});
