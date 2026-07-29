/**
 * `@susp/personas` — packs de arquetipos y escenarios por vertical.
 *
 * Cada pack modela cómo se comporta la gente en ese tipo de app: quién publica
 * y quién solo mira, a qué hora se conecta cada uno, qué persigue. De eso
 * depende que un entorno poblado se parezca a uno usado y no a una tabla con
 * filas.
 *
 * Se siembran en el motor con:
 *
 *   SUSP_API_KEY=... node scripts/sembrar.ts
 */

export * from './tipos.ts';
export { packSocial } from './packs/social.ts';
export { packCitas } from './packs/citas.ts';
export { packMarketplace } from './packs/marketplace.ts';
export { packTelemedicina } from './packs/telemedicina.ts';

import { packSocial } from './packs/social.ts';
import { packCitas } from './packs/citas.ts';
import { packMarketplace } from './packs/marketplace.ts';
import { packTelemedicina } from './packs/telemedicina.ts';
import type { Pack, Vertical } from './tipos.ts';

export const PACKS: Pack[] = [packSocial, packCitas, packMarketplace, packTelemedicina];

export function packDe(vertical: Vertical): Pack | undefined {
  return PACKS.find((pack) => pack.vertical === vertical);
}

/**
 * Reparte `total` agentes entre las personas del pack según su proporción.
 *
 * El reparto proporcional es lo que hace creíble la población: en una red social
 * la mayoría lee y unos pocos publican, y si se reparte en partes iguales el
 * resultado no se parece a ninguna comunidad real. Los restos del redondeo van
 * a las personas más frecuentes, que es donde menos se notan.
 */
export function repartir(pack: Pack, total: number): Array<{ slug: string; cantidad: number }> {
  if (total <= 0) return [];

  const ordenadas = [...pack.personas].sort((a, b) => b.proporcion - a.proporcion);

  // Con menos agentes que arquetipos no se puede dar uno a cada uno sin pasarse
  // del total. Se eligen los más frecuentes: es preferible una población chica
  // pero representativa a una que incumpla la cantidad pedida.
  if (total < ordenadas.length) {
    return ordenadas.slice(0, total).map((persona) => ({ slug: persona.slug, cantidad: 1 }));
  }

  const reparto = ordenadas.map((persona) => ({
    slug: persona.slug,
    // Al menos uno cada uno: un arquetipo con cero instancias es lo mismo que
    // no haberlo definido, y acá ya sabemos que el total alcanza.
    cantidad: Math.max(1, Math.floor(total * persona.proporcion)),
  }));

  let asignados = reparto.reduce((suma, fila) => suma + fila.cantidad, 0);

  // Sobrantes del redondeo → a las personas más frecuentes, que es donde menos
  // se nota la desviación.
  for (let i = 0; asignados < total; i++) {
    reparto[i % reparto.length].cantidad += 1;
    asignados += 1;
  }

  // Si el mínimo de uno se pasó del total, se recorta desde las menos
  // frecuentes, sin dejar a nadie en cero.
  for (let i = reparto.length - 1; asignados > total && i >= 0; ) {
    if (reparto[i].cantidad > 1) {
      reparto[i].cantidad -= 1;
      asignados -= 1;
    } else {
      i -= 1;
    }
  }

  return reparto;
}

/**
 * Comprueba que la app destino declare lo que el pack necesita.
 *
 * Correr un pack contra una app que no soporta sus operaciones produce una
 * campaña llena de `501`. Es mejor saberlo antes de arrancar.
 */
export function verificarCompatibilidad(
  pack: Pack,
  manifiesto: { capabilities?: string[]; content_types?: string[]; interaction_types?: string[] },
): { compatible: boolean; faltantes: string[] } {
  const faltantes: string[] = [];

  for (const capacidad of pack.requiere.capabilities) {
    if (!manifiesto.capabilities?.includes(capacidad)) {
      faltantes.push(`capacidad "${capacidad}"`);
    }
  }
  for (const tipo of pack.requiere.contentTypes) {
    if (manifiesto.content_types && !manifiesto.content_types.includes(tipo)) {
      faltantes.push(`tipo de contenido "${tipo}"`);
    }
  }
  for (const tipo of pack.requiere.interactionTypes) {
    if (manifiesto.interaction_types && !manifiesto.interaction_types.includes(tipo)) {
      faltantes.push(`tipo de interacción "${tipo}"`);
    }
  }

  return { compatible: faltantes.length === 0, faltantes };
}
