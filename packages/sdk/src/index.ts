/**
 * `@susp/sdk` — cliente tipado del motor SUSP.
 *
 * Para integrarlo en un script de CI, una herramienta interna o el propio
 * dashboard, sin escribir `fetch` a mano ni adivinar la forma de las respuestas.
 *
 * ```ts
 * const susp = new SuspClient({
 *   baseUrl: 'http://localhost:55701/api/v1',
 *   apiKey: process.env.SUSP_API_KEY!,
 * });
 *
 * const app = await susp.createTargetApp({ ... });
 * await susp.checkTargetAppHealth(app.id);
 *
 * const campaign = await susp.createCampaign({ ... });
 * const run = await susp.startCampaign(campaign.id, { dryRun: true });
 * await susp.waitForRun(run.id);
 * ```
 */

export { SuspClient, type SuspClientOptions, type Pagination } from './client.ts';
export { SuspError, type SuspErrorKind } from './errors.ts';
export * from './types.ts';
