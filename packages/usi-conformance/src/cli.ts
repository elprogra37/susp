#!/usr/bin/env node
/**
 * CLI de conformidad USI.
 *
 *   npx @susp/usi-conformance --url https://mi-app.example/usi/v1 --token <token>
 *
 * Sale con código 1 si la implementación no es conforme, para poder usarlo como
 * puerta en un pipeline de CI.
 */

import { randomUUID } from 'node:crypto';
import { ConformanceSuite } from './suite.ts';
import type { CheckResult, SuiteReport } from './types.ts';

const COLORS = {
  reset: '[0m',
  bold: '[1m',
  dim: '[2m',
  green: '[32m',
  red: '[31m',
  yellow: '[33m',
  blue: '[34m',
  gray: '[90m',
};

// Se respeta NO_COLOR y se desactiva el color si la salida no es una terminal.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (color: keyof typeof COLORS, text: string): string =>
  useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text;

interface Args {
  url?: string;
  token?: string;
  simulationId: string;
  timeoutMs: number;
  keepData: boolean;
  verbose: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    simulationId: `conformance_${randomUUID().slice(0, 12)}`,
    timeoutMs: 15_000,
    keepData: false,
    verbose: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => argv[++i] ?? '';

    switch (arg) {
      case '--url':
      case '-u':
        args.url = next();
        break;
      case '--token':
      case '-t':
        args.token = next();
        break;
      case '--simulation-id':
        args.simulationId = next();
        break;
      case '--timeout':
        args.timeoutMs = Number(next()) || 15_000;
        break;
      case '--keep-data':
        args.keepData = true;
        break;
      case '--verbose':
      case '-v':
        args.verbose = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Opción desconocida: ${arg}`);
          process.exit(2);
        }
    }
  }

  // Fallback a variables de entorno: cómodo en CI, y evita que el token quede
  // en el historial del shell.
  args.url ??= process.env.USI_URL;
  args.token ??= process.env.USI_TOKEN;

  return args;
}

function usage(): void {
  console.log(`
${c('bold', 'Suite de conformidad USI v1')}

Verifica que una implementación cumpla el estándar Universal Simulation
Interface. Crea datos de prueba y los borra al terminar.

${c('bold', 'Uso')}
  npx @susp/usi-conformance --url <url> --token <token>

${c('bold', 'Opciones')}
  -u, --url <url>          URL base de la API USI (ej: https://app.example/usi/v1)
  -t, --token <token>      Token bearer que espera la app
      --simulation-id <id> Identificador de la simulación de prueba (por defecto, uno aleatorio)
      --timeout <ms>       Timeout por petición (por defecto 15000)
      --keep-data          No purgar al terminar, para inspeccionar a mano
      --json               Salida JSON, para consumirla desde un script
  -v, --verbose            Mostrar el detalle también de los checks que pasan
  -h, --help               Esta ayuda

También se pueden usar las variables de entorno ${c('dim', 'USI_URL')} y ${c('dim', 'USI_TOKEN')},
que además evitan dejar el token en el historial del shell.

${c('bold', 'Códigos de salida')}
  0  conforme
  1  no conforme (algún check falló)
  2  error de uso

${c('bold', 'Qué verifica')}
  · Los cuatro endpoints obligatorios: manifest, auth/verify, state, purge
  · Que toda entidad creada exponga synthetic, simulation_id y agent_id
  · Que se rechace interactuar con una entidad NO sintética
  · Idempotencia: repetir con la misma clave no duplica
  · Formato de error único
  · Que el nonce de purga sea obligatorio y de un solo uso
  · Que dry_run cuente sin borrar
`);
}

function icon(status: CheckResult['status']): string {
  switch (status) {
    case 'pass':
      return c('green', '  ✓');
    case 'fail':
      return c('red', '  ✗');
    case 'warn':
      return c('yellow', '  !');
    default:
      return c('gray', '  –');
  }
}

function printReport(report: SuiteReport, verbose: boolean): void {
  console.log();
  for (const result of report.results) {
    const label =
      result.status === 'skip' ? c('gray', result.name) : result.name;
    console.log(`${icon(result.status)} ${label}`);

    // El detalle de un fallo siempre se muestra: es lo que hace accionable el
    // resultado. El de un check que pasa, solo en modo verboso.
    if (result.status === 'fail' || result.status === 'warn' || verbose) {
      for (const line of result.detail.split('\n')) {
        console.log(`      ${c('dim', line)}`);
      }
    }
  }

  console.log();
  const parts = [
    c('green', `${report.passed} bien`),
    report.failed > 0 ? c('red', `${report.failed} mal`) : `${report.failed} mal`,
    report.warnings > 0 ? c('yellow', `${report.warnings} avisos`) : `${report.warnings} avisos`,
    c('gray', `${report.skipped} salteados`),
  ];
  console.log(`  ${parts.join(c('dim', ' · '))}  ${c('dim', `(${report.durationMs} ms)`)}`);
  console.log();

  if (report.conformant) {
    console.log(c('green', c('bold', '  CONFORME con USI v1')));
    if (report.warnings > 0) {
      console.log(c('dim', '  Hay avisos: no impiden la integración, pero conviene revisarlos.'));
    }
  } else {
    console.log(c('red', c('bold', '  NO CONFORME')));
    console.log(
      c('dim', '  Corregí los checks marcados con ✗. El detalle de cada uno explica qué se esperaba.'),
    );
  }
  console.log();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    usage();
    process.exit(0);
  }

  if (!args.url || !args.token) {
    console.error(
      c('red', 'Faltan --url y/o --token.') +
        ' Probá --help, o definí USI_URL y USI_TOKEN.',
    );
    process.exit(2);
  }

  if (!args.json) {
    console.log();
    console.log(c('bold', '  Conformidad USI v1'));
    console.log(c('dim', `  destino:    ${args.url}`));
    console.log(c('dim', `  simulación: ${args.simulationId}`));
  }

  const suite = new ConformanceSuite({
    baseUrl: args.url,
    token: args.token,
    simulationId: args.simulationId,
    timeoutMs: args.timeoutMs,
    keepData: args.keepData,
    verbose: args.verbose,
  });

  const report = await suite.run();

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, args.verbose);
    if (args.keepData) {
      console.log(
        c('yellow', `  --keep-data: quedaron datos de la simulación ${args.simulationId}.`),
      );
      console.log();
    }
  }

  process.exit(report.conformant ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(c('red', 'La suite no pudo completarse:'), err);
  process.exit(2);
});
