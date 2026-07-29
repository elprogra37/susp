/**
 * PRNG sembrado (mulberry32) + utilidades.
 *
 * La reproducibilidad no es un lujo acá: cada agente guarda su semilla, así que
 * la misma campaña con las mismas semillas genera exactamente el mismo
 * comportamiento. Eso hace que un bug de simulación se pueda reproducir, y que
 * los tests no dependan de la suerte.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: string | number) {
    this.state = typeof seed === 'number' ? seed >>> 0 : SeededRandom.hash(seed);
  }

  /** Hash FNV-1a de 32 bits: barato, determinista y bien distribuido. */
  static hash(input: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Siguiente float en [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entero en [min, max], ambos incluidos. */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('No se puede elegir de una lista vacía.');
    }
    return items[Math.floor(this.next() * items.length)];
  }

  /** `count` elementos distintos, o todos si se piden más de los que hay. */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const result: T[] = [];
    const take = Math.min(count, pool.length);
    for (let i = 0; i < take; i++) {
      result.push(...pool.splice(Math.floor(this.next() * pool.length), 1));
    }
    return result;
  }

  /** Fisher-Yates sobre una copia. */
  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Elección ponderada. Es el mecanismo con el que un escenario define su
   * mezcla de acciones: `{ "content.create": 3, "interactions.create": 6 }`.
   */
  weighted<T extends string>(weights: Record<T, number>): T {
    const entries = (Object.entries(weights) as Array<[T, number]>).filter(
      ([, weight]) => weight > 0,
    );
    if (entries.length === 0) {
      throw new Error('No hay ninguna opción con peso mayor a cero.');
    }
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [key, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return key;
    }
    return entries[entries.length - 1][0];
  }

  /**
   * Normal aproximada (Box-Muller), recortada al rango. Sirve para variar los
   * rasgos de una persona entre sus agentes sin que se vayan de escala.
   */
  normal(mean: number, stdDev: number, min = 0, max = 1): number {
    const u1 = Math.max(this.next(), Number.EPSILON);
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.min(max, Math.max(min, mean + z * stdDev));
  }

  /** Deriva un PRNG hijo, para que subsistemas distintos no compartan estado. */
  derive(label: string): SeededRandom {
    return new SeededRandom(`${this.state}:${label}`);
  }
}
