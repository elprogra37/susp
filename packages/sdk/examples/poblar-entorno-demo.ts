/**
 * Ejemplo ejecutable: poblar un entorno de demostración de punta a punta.
 *
 *   SUSP_API_KEY=... USI_TOKEN=... node examples/poblar-entorno-demo.ts
 *
 * Es el caso de uso real: antes de mostrarle la app a alguien, correr esto para
 * que el entorno tenga gente adentro en vez de estar vacío.
 */

import { SuspClient, SuspError } from '../src/index.ts';

const SUSP_URL = process.env.SUSP_URL ?? 'http://localhost:55701/api/v1';
const SUSP_API_KEY = process.env.SUSP_API_KEY;
const APP_USI_URL = process.env.APP_USI_URL ?? 'http://localhost:55704/usi/v1';
const APP_USI_TOKEN = process.env.APP_USI_TOKEN ?? 'reference-token-dev';

if (!SUSP_API_KEY) {
  console.error('Falta SUSP_API_KEY. Sale del seed: `make seed`.');
  process.exit(1);
}

const susp = new SuspClient({ baseUrl: SUSP_URL, apiKey: SUSP_API_KEY });
const sufijo = Date.now().toString(36);

async function main(): Promise<void> {
  // 1. Registrar la app destino y comprobar que hable USI.
  const app = await susp.createTargetApp({
    name: 'Demo',
    slug: `demo-${sufijo}`,
    baseUrl: APP_USI_URL,
    env: 'DEVELOPMENT',
    vertical: 'SOCIAL',
    token: APP_USI_TOKEN,
  });

  const verificada = await susp.checkTargetAppHealth(app.id);
  console.log(`App "${verificada.slug}": ${verificada.health} — ${verificada.healthDetail}`);

  if (verificada.health !== 'HEALTHY') {
    // Arrancar contra una app que no responde solo produce una campaña llena de
    // errores: mejor frenar acá con un mensaje claro.
    throw new Error(
      `La app no está sana (${verificada.health}). Corregí eso antes de poblarla.`,
    );
  }

  // 2. Definir quiénes son los usuarios sintéticos.
  const persona = await susp.createPersona({
    name: 'Vecina activa',
    slug: `vecina-activa-${sufijo}`,
    vertical: 'SOCIAL',
    description: 'Publica seguido, comenta todo, responde rápido.',
    traits: { extraversion: 0.85, chattiness: 0.9, formality: 0.25, agreeableness: 0.8 },
    interests: ['ferias de barrio', 'huerta', 'cocina', 'ciclismo'],
    goals: [
      { kind: 'content.create', target: 3 },
      { kind: 'interactions.create', target: 10 },
    ],
  });

  // 3. Y qué tienen que hacer.
  const escenario = await susp.createScenario({
    name: 'Feed activo',
    slug: `feed-activo-${sufijo}`,
    vertical: 'SOCIAL',
    actionMix: {
      'content.create': 3,
      'interactions.create': 6,
      'messaging.send': 2,
      'users.update': 1,
    },
    intensity: 4,
  });

  // 4. La campaña.
  const campaña = await susp.createCampaign({
    name: `Demo ${sufijo}`,
    targetAppId: app.id,
    scenarioId: escenario.id,
    personaIds: [persona.id],
    agentCount: 12,
    // El reloj simulado avanza 3 horas por minuto real, así los agentes llegan
    // a su horario activo sin esperar a mañana.
    timeScale: 180,
  });

  // 5. Primero en seco. Estrenar una integración escribiendo de una es la forma
  //    más rápida de ensuciar un entorno ajeno.
  console.log('\nSimulacro...');
  const simulacro = await susp.startCampaign(campaña.id, { dryRun: true });
  const resultadoSimulacro = await susp.waitForRun(simulacro.id, { timeoutMs: 120_000 });
  console.log(
    `  ${resultadoSimulacro.jobsTotal} acciones planificadas, ` +
      `${resultadoSimulacro.jobsSucceeded} simuladas sin escribir nada.`,
  );

  // 6. Ahora de verdad.
  console.log('\nPoblando de verdad...');
  const ejecución = await susp.startCampaign(campaña.id);
  const resultado = await susp.waitForRun(ejecución.id, { timeoutMs: 10 * 60_000 });

  console.log(`  Estado: ${resultado.status}`);
  console.log(`  ${resultado.jobsSucceeded} acciones aplicadas, ${resultado.jobsFailed} fallidas`);
  for (const fila of resultado.jobsByOperation) {
    console.log(`    ${fila.operation.padEnd(22)} ${fila.count}`);
  }

  const entidades = await susp.listEntities(ejecución.id, { limit: 1 });
  console.log(`  ${entidades.total} entidades creadas en la app destino.`);

  console.log(`\nPara borrar todo esto cuando termines la demo:`);
  console.log(
    `  susp.purgeCampaign('${campaña.id}', { confirmName: ${JSON.stringify(campaña.name)} })`,
  );
}

main().catch((err: unknown) => {
  if (err instanceof SuspError) {
    console.error(`\nError del motor [${err.kind}${err.code ? `/${err.code}` : ''}]: ${err.message}`);
    if (err.details) console.error(JSON.stringify(err.details, null, 2));
  } else {
    console.error('\nError:', err);
  }
  process.exit(1);
});
