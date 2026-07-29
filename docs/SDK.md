# Referencia del SDK

`@susp/sdk` es el cliente tipado del motor. Sirve para integrar SUSP en un script
de CI, una herramienta interna o el propio dashboard sin escribir `fetch` a mano
ni adivinar la forma de las respuestas.

Es una capa fina sobre HTTP: no guarda estado ni cachea nada.

---

## Instalar y conectar

```ts
import { SuspClient, SuspError } from '@susp/sdk';

const susp = new SuspClient({
  baseUrl: 'http://localhost:55701/api/v1',
  apiKey: process.env.SUSP_API_KEY,   // o jwt: '<token de sesión>'
});
```

| Opción | Por defecto | Para qué |
| --- | --- | --- |
| `baseUrl` | — | URL de la API del motor. |
| `apiKey` | — | Cabecera `X-Susp-Key`. Para integraciones y automatización. |
| `jwt` | — | `Authorization: Bearer`. Para sesiones del dashboard. |
| `timeoutMs` | `30000` | Timeout por petición. |
| `fetchImpl` | `globalThis.fetch` | Inyectable, para testear sin red. |

Hace falta `apiKey` **o** `jwt`; sin ninguno, el constructor falla en el acto en
vez de dejar que cada petición devuelva `401`.

---

## Errores

Todo lo que falla lanza `SuspError`, que conserva el cuerpo del motor para poder
diagnosticar:

```ts
try {
  await susp.startCampaign(id);
} catch (err) {
  if (err instanceof SuspError) {
    console.error(err.kind);        // 'conflict', 'forbidden', 'unprocessable'…
    console.error(err.httpStatus);  // 409
    console.error(err.code);        // código del motor
    console.error(err.details);     // detalle estructurado, si lo hay
    if (err.retryable) { /* red, timeout, 429 o 5xx */ }
  }
}
```

`retryable` es `true` solo para lo que puede resolverse solo: red, timeout, `429`
y `5xx`. Un `422` no lo es — el motor rechazó por sus reglas, y repetir da lo
mismo.

---

## Apps destino

```ts
const app = await susp.createTargetApp({
  name: 'Nocturna',
  slug: 'nocturna',
  baseUrl: 'https://proyecto.supabase.co/functions/v1/usi/usi/v1',
  env: 'DEVELOPMENT',
  vertical: 'SOCIAL',
  token: process.env.USI_TOKEN,   // se guarda cifrado; no vuelve a salir
});

// Lee el manifiesto, verifica credenciales y cachea capacidades.
const verificada = await susp.checkTargetAppHealth(app.id);
if (verificada.health !== 'HEALTHY') {
  throw new Error(`La app no está sana: ${verificada.healthDetail}`);
}
```

| Método | |
| --- | --- |
| `listTargetApps(params?)` | |
| `getTargetApp(id)` | |
| `createTargetApp(input)` | |
| `updateTargetApp(id, input)` | |
| `deleteTargetApp(id)` | |
| `checkTargetAppHealth(id)` | Interroga la app y cachea su manifiesto. |
| `setProductionWrites(id, input)` | Exige `confirmSlug` exacto y `confirmPhrase: 'ENTIENDO EL RIESGO'`. |

---

## Personas y escenarios

```ts
const persona = await susp.createPersona({
  name: 'Vecina activa',
  slug: 'vecina-activa',
  vertical: 'SOCIAL',
  traits: { extraversion: 0.85, chattiness: 0.9, formality: 0.25 },
  interests: ['ferias de barrio', 'huerta'],
  goals: [{ kind: 'content.create', target: 3 }],
});

const escenario = await susp.createScenario({
  name: 'Feed activo',
  slug: 'feed-activo',
  vertical: 'SOCIAL',
  actionMix: { 'content.create': 3, 'interactions.create': 6 },
  intensity: 4,
});
```

Los rasgos van de 0 a 1; lo que no declares queda en 0,5. La mezcla de acciones
solo acepta operaciones USI reales: si ponés una inventada, el motor responde
`400` con el nombre del problema en vez de encolar trabajo que fallaría con `501`.

Para no escribirlos a mano, `@susp/personas` trae packs por vertical:

```bash
make sembrar key=<tu API key>
```

---

## Campañas

```ts
const campaña = await susp.createCampaign({
  name: 'Demo del jueves',
  targetAppId: app.id,
  scenarioId: escenario.id,
  personaIds: [persona.id],
  agentCount: 40,
  timeScale: 180,                    // 3 horas simuladas por minuto real
  config: {
    // Reparto proporcional en vez de parejo. Sin esto, una red social queda
    // con todos los arquetipos en la misma cantidad, que no se parece a
    // ninguna comunidad real.
    personaMix: { [persona.id]: 55, [otra.id]: 22 },
  },
});
```

| Método | |
| --- | --- |
| `listCampaigns(params?)` / `getCampaign(id)` | |
| `createCampaign(input)` / `updateCampaign(id, input)` | |
| `startCampaign(id, { dryRun? })` | Encola una ejecución. |
| `pauseCampaign(id)` / `cancelCampaign(id)` | |
| `purgeCampaign(id, { confirmName, dryRun? })` | `confirmName` debe ser el nombre exacto. |
| `deleteCampaign(id)` | Falla si quedan entidades sin purgar. |

### `timeScale`

Los agentes tienen horarios. Con `timeScale: 1` una campaña arrancada de
madrugada no hace nada hasta que amanezca. Con `60`, una hora simulada por minuto
real; con `180`, tres. Para una demo, entre 60 y 240.

---

## Ejecuciones y agentes

```ts
const run = await susp.startCampaign(campaña.id, { dryRun: true });
const resultado = await susp.waitForRun(run.id, { timeoutMs: 120_000 });

console.log(resultado.status, resultado.jobsSucceeded, resultado.jobsFailed);
for (const fila of resultado.jobsByOperation) {
  console.log(fila.operation, fila.count, fila.avgDurationMs);
}
```

`waitForRun` sondea hasta que la ejecución llega a un estado final. Si vence el
plazo lanza `SuspError` con `kind: 'timeout'` — puede ser normal: una campaña sin
fecha de fin corre hasta que sus agentes cumplen sus objetivos.

| Método | |
| --- | --- |
| `listRuns(params?)` / `getRun(id)` | |
| `listJobs(runId, params?)` | Trabajos encolados, con su estado y error. |
| `listEntities(runId, params?)` | Entidades creadas en la app destino. |
| `listAgents(params?)` / `getAgent(id)` | |
| `getAgentMemories(id, params?)` | Con la fuerza ya decaída por el tiempo. |
| `waitForRun(id, opciones?)` | |

`getAgentMemories` es la vista que explica **por qué** un agente hizo lo que hizo:
qué recuerda, con quién interactuó y cuánto pesa cada recuerdo ahora.

---

## Auditoría

```ts
const errores = await susp.listAudit({ result: 'ERROR', limit: 50 });
const resumen = await susp.auditSummary(24);   // últimas 24 horas
```

---

## Ejemplo completo

Hay un script ejecutable que hace todo el circuito —registrar la app, verificarla,
definir persona y escenario, simular y después poblar de verdad— en
[`packages/sdk/examples/poblar-entorno-demo.ts`](../packages/sdk/examples/poblar-entorno-demo.ts).

```bash
SUSP_API_KEY=... node packages/sdk/examples/poblar-entorno-demo.ts
```

---

## Un patrón que conviene seguir

Estrenar una integración escribiendo de una es la forma más rápida de ensuciar un
entorno ajeno. El circuito recomendado:

```ts
// 1. Verificar que la app responda y sea conforme.
const app = await susp.checkTargetAppHealth(appId);
if (app.health !== 'HEALTHY') throw new Error(app.healthDetail ?? 'app no sana');

// 2. Simular: calcula el plan completo sin escribir nada.
const simulacro = await susp.startCampaign(campaignId, { dryRun: true });
const plan = await susp.waitForRun(simulacro.id);
console.log(`${plan.jobsTotal} acciones planificadas`);

// 3. Recién ahora, de verdad.
const real = await susp.startCampaign(campaignId);
await susp.waitForRun(real.id);

// 4. Y cuando termine la demo, limpiar.
await susp.purgeCampaign(campaignId, { confirmName: campaña.name });
```
