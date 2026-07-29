/**
 * Validadores del contrato USI, **sin dependencias**.
 *
 * Se escriben a mano en vez de usar zod por una razón concreta: este paquete lo
 * consume `@susp/usi-server`, pensado para correr dentro de una Supabase Edge
 * Function en Deno. Ahí, cada dependencia npm es fricción. Un validador de
 * doscientas líneas sin deps se copia y funciona en cualquier runtime.
 */

// Los tipos se importan con `import type` a propósito: al ejecutarse con el
// borrado de tipos de Node, un import normal de algo que solo existe en tiempo
// de compilación falla en runtime buscando una exportación que no existe.
import { USI_CAPABILITIES } from './types.ts';
import type {
  UsiCapability,
  UsiCreateContentRequest,
  UsiCreateInteractionRequest,
  UsiCreateUserRequest,
  UsiManifest,
  UsiPurgeRequest,
  UsiSendMessageRequest,
  UsiSyntheticMarker,
} from './types.ts';

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

class Checker {
  readonly issues: ValidationIssue[] = [];

  // Campo explícito en vez de "parameter property": este paquete se ejecuta
  // con el borrado de tipos de Node y en Deno, y ninguno de los dos transforma
  // azúcar sintáctico de TypeScript — solo quitan los tipos.
  private readonly root: unknown;

  constructor(root: unknown) {
    this.root = root;
  }

  private at(path: string): unknown {
    // La ruta vacía es la raíz. Sin este caso, `''.split('.')` da `['']` y
    // terminaría buscando una clave literalmente llamada "".
    if (path === '') return this.root;

    let current: unknown = this.root;
    for (const segment of path.split('.')) {
      if (typeof current !== 'object' || current === null) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  fail(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  requiredString(path: string, opts: { min?: number } = {}): string | undefined {
    const value = this.at(path);
    if (typeof value !== 'string') {
      this.fail(path, 'Falta o no es una cadena de texto.');
      return undefined;
    }
    if (value.trim().length < (opts.min ?? 1)) {
      this.fail(path, `Tiene que tener al menos ${opts.min ?? 1} caracteres.`);
      return undefined;
    }
    return value;
  }

  optionalString(path: string): string | undefined {
    const value = this.at(path);
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
      this.fail(path, 'Tiene que ser una cadena de texto.');
      return undefined;
    }
    return value;
  }

  requiredObject(path: string): Record<string, unknown> | undefined {
    const value = this.at(path);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(path, 'Falta o no es un objeto.');
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  requiredArray(path: string, opts: { min?: number } = {}): unknown[] | undefined {
    const value = this.at(path);
    if (!Array.isArray(value)) {
      this.fail(path, 'Falta o no es una lista.');
      return undefined;
    }
    if (value.length < (opts.min ?? 0)) {
      this.fail(path, `Necesita al menos ${opts.min} elemento(s).`);
      return undefined;
    }
    return value;
  }

  requiredNumber(path: string): number | undefined {
    const value = this.at(path);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.fail(path, 'Falta o no es un número.');
      return undefined;
    }
    return value;
  }

  oneOf<T extends string>(path: string, allowed: readonly T[]): T | undefined {
    const value = this.at(path);
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.fail(path, `Tiene que ser uno de: ${allowed.join(', ')}.`);
      return undefined;
    }
    return value as T;
  }

  result<T>(value: T): ValidationResult<T> {
    return this.issues.length === 0 ? { ok: true, value } : { ok: false, issues: this.issues };
  }
}

// ─────────────────────────────── manifiesto ───────────────────────────────

export function validateManifest(input: unknown): ValidationResult<UsiManifest> {
  const check = new Checker(input);

  const version = check.requiredString('usi_version');
  if (version && !/^\d+\.\d+\.\d+$/.test(version)) {
    check.fail('usi_version', 'Tiene que ser semántica: MAJOR.MINOR.PATCH.');
  }

  check.requiredObject('app');
  check.requiredString('app.name');
  check.oneOf('app.environment', ['development', 'staging', 'production'] as const);
  check.oneOf('app.vertical', [
    'dating',
    'social',
    'telemedicine',
    'marketplace',
    'other',
  ] as const);

  const capabilities = check.requiredArray('capabilities');
  if (capabilities) {
    capabilities.forEach((capability, index) => {
      if (
        typeof capability !== 'string' ||
        !USI_CAPABILITIES.includes(capability as UsiCapability)
      ) {
        check.fail(
          `capabilities[${index}]`,
          `"${String(capability)}" no es una capacidad USI conocida.`,
        );
      }
    });
  }

  return check.result(input as UsiManifest);
}

// ─────────────────────────── marcado sintético ───────────────────────────

/**
 * Comprueba el marcado obligatorio de una entidad creada.
 *
 * Es la validación más importante del estándar: una implementación que devuelva
 * entidades sin `synthetic: true` **no es conforme**, porque nada del lado del
 * consumidor podría distinguir un agente de una persona.
 */
export function validateSyntheticMarker(
  input: unknown,
  context = 'entidad',
): ValidationResult<UsiSyntheticMarker> {
  const check = new Checker(input);
  const record = check.requiredObject('');

  if (record) {
    if (record.synthetic !== true) {
      check.fail(
        'synthetic',
        `La entidad creada (${context}) no expone "synthetic": true. El marcado es ` +
          'obligatorio: ' +
          'sin él, un consumidor no puede distinguir un agente sintético de una persona real.',
      );
    }
    check.requiredString('simulation_id');
    check.requiredString('agent_id');
    check.requiredString('id');
  }

  return check.result(input as UsiSyntheticMarker);
}

// ─────────────────────────────── escrituras ───────────────────────────────

export function validateCreateUser(input: unknown): ValidationResult<UsiCreateUserRequest> {
  const check = new Checker(input);
  check.requiredString('agent_id');
  check.requiredString('simulation_id');
  check.requiredObject('profile');
  check.requiredString('profile.display_name');

  const email = check.optionalString('profile.email');
  if (email && !email.endsWith('.invalid')) {
    // Advertencia dura a propósito: un email sintético en un dominio entregable
    // es la forma más fácil de mandarle un correo real a alguien por accidente.
    check.fail(
      'profile.email',
      'Los emails sintéticos deberían usar el TLD reservado .invalid (RFC 2606), ' +
        'para que sea imposible entregarles un correo real.',
    );
  }

  return check.result(input as UsiCreateUserRequest);
}

export function validateCreateContent(
  input: unknown,
): ValidationResult<UsiCreateContentRequest> {
  const check = new Checker(input);
  check.requiredString('agent_id');
  check.requiredString('simulation_id');
  check.requiredString('author_id');
  check.requiredString('type');
  return check.result(input as UsiCreateContentRequest);
}

export function validateCreateInteraction(
  input: unknown,
): ValidationResult<UsiCreateInteractionRequest> {
  const check = new Checker(input);
  check.requiredString('agent_id');
  check.requiredString('simulation_id');
  check.requiredString('actor_id');
  check.requiredString('type');
  check.oneOf('target_type', ['user', 'content', 'interaction'] as const);
  check.requiredString('target_id');
  return check.result(input as UsiCreateInteractionRequest);
}

export function validateSendMessage(
  input: unknown,
): ValidationResult<UsiSendMessageRequest> {
  const check = new Checker(input);
  check.requiredString('agent_id');
  check.requiredString('simulation_id');
  check.requiredString('from_id');
  check.requiredString('body');

  const recipients = check.requiredArray('to_ids', { min: 1 });
  recipients?.forEach((id, index) => {
    if (typeof id !== 'string' || id.trim() === '') {
      check.fail(`to_ids[${index}]`, 'Tiene que ser un identificador no vacío.');
    }
  });

  return check.result(input as UsiSendMessageRequest);
}

export function validatePurgeRequest(input: unknown): ValidationResult<UsiPurgeRequest> {
  const check = new Checker(input);
  check.requiredString('purge_token');
  const scope = check.oneOf('scope', ['simulation', 'all'] as const);
  if (scope === 'simulation') {
    check.requiredString('simulation_id');
  }
  return check.result(input as UsiPurgeRequest);
}

// ─────────────────────────────── estado ───────────────────────────────

export function validateState(input: unknown): ValidationResult<unknown> {
  const check = new Checker(input);
  const record = check.requiredObject('');
  if (record && typeof record.healthy !== 'boolean') {
    check.fail('healthy', 'Falta o no es booleano.');
  }
  check.requiredString('usi_version');
  check.requiredObject('counts');
  for (const key of ['users', 'content', 'interactions', 'messages']) {
    check.requiredNumber(`counts.${key}`);
  }
  return check.result(input);
}

/** Formatea los problemas para mostrarlos en consola. */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues
    .map((issue) => `    ${issue.path === '' ? '(raíz)' : issue.path}: ${issue.message}`)
    .join('\n');
}
