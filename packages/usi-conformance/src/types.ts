export type CheckStatus = 'pass' | 'fail' | 'skip' | 'warn';

export interface CheckResult {
  /** Identificador estable, para poder referirse a un check en la documentación. */
  id: string;
  name: string;
  status: CheckStatus;
  /** Qué se observó. En un fallo, tiene que alcanzar para arreglarlo sin adivinar. */
  detail: string;
  /** Capacidad que lo habilita; si la app no la declara, el check se saltea. */
  capability?: string;
  durationMs?: number;
}

export interface SuiteOptions {
  readonly baseUrl: string;
  readonly token: string;
  /** Identificador de la simulación de prueba. */
  readonly simulationId: string;
  readonly timeoutMs: number;
  /** No purgar al terminar. Útil para inspeccionar a mano lo que quedó. */
  readonly keepData: boolean;
  readonly verbose: boolean;
}

export interface SuiteReport {
  results: CheckResult[];
  passed: number;
  failed: number;
  skipped: number;
  warnings: number;
  durationMs: number;
  conformant: boolean;
}
