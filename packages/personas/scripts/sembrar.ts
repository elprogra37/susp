/**
 * Siembra los packs en el catálogo del motor.
 *
 *   SUSP_API_KEY=... node scripts/sembrar.ts
 *   SUSP_API_KEY=... node scripts/sembrar.ts --vertical SOCIAL
 *
 * Es idempotente: si una persona o escenario ya existe con ese slug, lo saltea
 * en vez de fallar. Así se puede correr después de agregar un pack nuevo sin
 * tener que limpiar antes.
 */

import { SuspClient, SuspError } from '@susp/sdk';
import { PACKS } from '../src/index.ts';
import type { Pack } from '../src/tipos.ts';

const SUSP_URL = process.env.SUSP_URL ?? 'http://localhost:55701/api/v1';
const SUSP_API_KEY = process.env.SUSP_API_KEY;

if (!SUSP_API_KEY) {
  console.error('Falta SUSP_API_KEY. Sale del seed del motor: `make seed`.');
  process.exit(1);
}

const soloVertical = leerArgumento('--vertical');
const susp = new SuspClient({ baseUrl: SUSP_URL, apiKey: SUSP_API_KEY });

function leerArgumento(nombre: string): string | undefined {
  const indice = process.argv.indexOf(nombre);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
}

async function sembrarPack(pack: Pack): Promise<{ personas: number; escenarios: number }> {
  let personas = 0;
  let escenarios = 0;

  for (const persona of pack.personas) {
    try {
      await susp.createPersona({
        name: persona.name,
        slug: persona.slug,
        vertical: pack.vertical,
        description: persona.description,
        traits: persona.traits,
        interests: persona.interests,
        goals: persona.goals,
        schedule: persona.schedule as unknown as Record<string, unknown>,
        rules: persona.rules ?? [],
      });
      personas += 1;
    } catch (err) {
      // Un slug repetido significa que ya estaba: no es un error, es que el
      // script ya se corrió antes.
      if (err instanceof SuspError && err.kind === 'conflict') continue;
      throw err;
    }
  }

  for (const escenario of pack.escenarios) {
    try {
      await susp.createScenario({
        name: escenario.name,
        slug: escenario.slug,
        vertical: pack.vertical,
        description: escenario.description,
        actionMix: escenario.actionMix,
        intensity: escenario.intensity,
        seed: escenario.seed ?? {},
      });
      escenarios += 1;
    } catch (err) {
      if (err instanceof SuspError && err.kind === 'conflict') continue;
      throw err;
    }
  }

  return { personas, escenarios };
}

async function main(): Promise<void> {
  const packs = soloVertical
    ? PACKS.filter((p) => p.vertical === soloVertical.toUpperCase())
    : PACKS;

  if (packs.length === 0) {
    console.error(
      `No hay pack para el vertical "${soloVertical}". Opciones: ` +
        PACKS.map((p) => p.vertical).join(', '),
    );
    process.exit(1);
  }

  console.log(`Sembrando en ${SUSP_URL}\n`);

  let totalPersonas = 0;
  let totalEscenarios = 0;

  for (const pack of packs) {
    const resultado = await sembrarPack(pack);
    totalPersonas += resultado.personas;
    totalEscenarios += resultado.escenarios;

    const salteadas = pack.personas.length - resultado.personas;
    console.log(
      `  ${pack.vertical.padEnd(13)} ${resultado.personas} personas, ` +
        `${resultado.escenarios} escenarios` +
        (salteadas > 0 ? `  (${salteadas} ya existían)` : ''),
    );
  }

  console.log(
    `\nListo: ${totalPersonas} personas y ${totalEscenarios} escenarios nuevos.`,
  );
  console.log('Se ven en el dashboard, en "Personas y escenarios".');
}

main().catch((err: unknown) => {
  if (err instanceof SuspError) {
    console.error(`\nError del motor [${err.kind}]: ${err.message}`);
  } else {
    console.error('\nError:', err);
  }
  process.exit(1);
});
