import { AgentFactoryService } from './agent-factory.service';
import type { Persona } from '@prisma/client';
import type { PrismaService } from '../common/prisma/prisma.service';

/**
 * El reparto de personas es privado, pero es la pieza que decide si una
 * población se parece a una comunidad real o a una lista de clones. Se prueba a
 * través de un acceso explícito por índice, en vez de exponerlo solo para el
 * test: sacarlo a público invitaría a llamarlo desde otro lado.
 */
type ConRepartir = {
  repartir(personas: Persona[], count: number, weights?: Record<string, number>): Persona[];
};

function persona(id: string): Persona {
  return { id, slug: id, name: id } as Persona;
}

describe('AgentFactoryService — reparto de personas', () => {
  const factory = new AgentFactoryService({} as PrismaService);
  const repartir = (
    personas: Persona[],
    count: number,
    weights?: Record<string, number>,
  ): Persona[] => (factory as unknown as ConRepartir).repartir(personas, count, weights);

  const cuatro = [persona('a'), persona('b'), persona('c'), persona('d')];

  function contar(resultado: Persona[]): Record<string, number> {
    const cuenta: Record<string, number> = {};
    for (const p of resultado) cuenta[p.id] = (cuenta[p.id] ?? 0) + 1;
    return cuenta;
  }

  it('devuelve exactamente la cantidad pedida', () => {
    for (const total of [1, 2, 4, 5, 20, 137, 1000]) {
      expect(repartir(cuatro, total)).toHaveLength(total);
    }
  });

  it('sin pesos reparte parejo', () => {
    const cuenta = contar(repartir(cuatro, 20));
    expect(Object.values(cuenta)).toEqual([5, 5, 5, 5]);
  });

  it('con pesos respeta las proporciones', () => {
    // 55/22/15/8 es la distribución del pack social: la mayoría lee, pocos publican.
    const cuenta = contar(
      repartir(cuatro, 100, { a: 55, b: 22, c: 15, d: 8 }),
    );
    expect(cuenta.a).toBeGreaterThan(cuenta.b);
    expect(cuenta.b).toBeGreaterThan(cuenta.c);
    expect(cuenta.c).toBeGreaterThan(cuenta.d);
    // Cerca de la proporción pedida, con margen por el redondeo.
    expect(cuenta.a).toBeGreaterThanOrEqual(50);
    expect(cuenta.a).toBeLessThanOrEqual(60);
  });

  it('ninguna persona queda en cero si el total alcanza', () => {
    const cuenta = contar(repartir(cuatro, 8, { a: 100, b: 1, c: 1, d: 1 }));
    for (const p of cuatro) {
      expect(cuenta[p.id] ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it('con menos agentes que personas elige las más frecuentes', () => {
    const resultado = repartir(cuatro, 2, { a: 1, b: 2, c: 3, d: 100 });
    expect(resultado).toHaveLength(2);
    expect(resultado.map((p) => p.id).sort()).toEqual(['c', 'd']);
  });

  it('intercala en vez de agrupar', () => {
    // Si los primeros agentes fueran todos del mismo arquetipo, cortar la
    // campaña temprano dejaría una población sesgada.
    const primeros = repartir(cuatro, 20).slice(0, 4).map((p) => p.id);
    expect(new Set(primeros).size).toBe(4);
  });

  it('es determinista', () => {
    const pesos = { a: 3, b: 2, c: 1, d: 1 };
    const uno = repartir(cuatro, 37, pesos).map((p) => p.id);
    const otro = repartir(cuatro, 37, pesos).map((p) => p.id);
    expect(uno).toEqual(otro);
  });

  it('ignora pesos inválidos y los trata como uno', () => {
    const cuenta = contar(
      repartir(cuatro, 20, { a: -5, b: Number.NaN, c: 0, d: 1 }),
    );
    expect(Object.values(cuenta).reduce((s, n) => s + n, 0)).toBe(20);
  });

  it('sin personas devuelve vacío', () => {
    expect(repartir([], 10)).toEqual([]);
  });
});
