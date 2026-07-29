/**
 * Piezas de interfaz compartidas.
 *
 * Sin librería de componentes a propósito: es un panel administrativo de una
 * decena de pantallas, y una dependencia de UI pesaría más que todo el código
 * que hay acá.
 */

import type { ReactNode } from 'react';

export function Insignia({
  valor,
  tono,
}: {
  valor: string;
  tono?: 'ok' | 'mal' | 'aviso' | 'neutro' | 'activo';
}): ReactNode {
  const t = tono ?? tonoDe(valor);
  return <span className={`insignia insignia--${t}`}>{etiquetaDe(valor)}</span>;
}

/** Traduce los enums del motor a algo legible, sin perder el valor original. */
function etiquetaDe(valor: string): string {
  const mapa: Record<string, string> = {
    HEALTHY: 'sana',
    DEGRADED: 'degradada',
    UNREACHABLE: 'inalcanzable',
    NON_CONFORMANT: 'no conforme',
    UNKNOWN: 'sin verificar',
    DRAFT: 'borrador',
    SCHEDULED: 'programada',
    RUNNING: 'en curso',
    PAUSED: 'pausada',
    COMPLETED: 'completada',
    FAILED: 'fallida',
    CANCELLED: 'cancelada',
    PENDING: 'pendiente',
    SUCCEEDED: 'ok',
    DEAD: 'muerto',
    IDLE: 'inactivo',
    ACTIVE: 'activo',
    EXHAUSTED: 'terminado',
    DISABLED: 'deshabilitado',
    DEVELOPMENT: 'desarrollo',
    STAGING: 'staging',
    PRODUCTION: 'producción',
    OK: 'ok',
    REJECTED: 'rechazado',
    ERROR: 'error',
    SKIPPED: 'omitido',
    DRY_RUN: 'simulación',
  };
  return mapa[valor] ?? valor.toLowerCase();
}

function tonoDe(valor: string): 'ok' | 'mal' | 'aviso' | 'neutro' | 'activo' {
  if (['HEALTHY', 'COMPLETED', 'SUCCEEDED', 'OK', 'ACTIVE'].includes(valor)) return 'ok';
  if (['FAILED', 'UNREACHABLE', 'NON_CONFORMANT', 'DEAD', 'ERROR'].includes(valor)) return 'mal';
  if (['DEGRADED', 'PAUSED', 'REJECTED', 'PRODUCTION', 'CANCELLED'].includes(valor)) return 'aviso';
  if (['RUNNING', 'PENDING', 'SCHEDULED'].includes(valor)) return 'activo';
  return 'neutro';
}

export function Panel({
  titulo,
  acciones,
  children,
}: {
  titulo: string;
  acciones?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="panel">
      <header className="panel__cabecera">
        <h2>{titulo}</h2>
        {acciones && <div className="panel__acciones">{acciones}</div>}
      </header>
      {children}
    </section>
  );
}

export function Estado({
  cargando,
  error,
  vacio,
  children,
}: {
  cargando: boolean;
  error: string | null;
  vacio?: boolean;
  children: ReactNode;
}): ReactNode {
  if (error) return <p className="mensaje mensaje--error">{error}</p>;
  if (cargando) return <p className="mensaje">Cargando…</p>;
  if (vacio) return <p className="mensaje">Todavía no hay nada acá.</p>;
  return <>{children}</>;
}

export function Metrica({
  etiqueta,
  valor,
  detalle,
}: {
  etiqueta: string;
  /** Acepta un nodo para poder mostrar una insignia en lugar de un número. */
  valor: ReactNode;
  detalle?: string;
}): ReactNode {
  return (
    <div className="metrica">
      <span className="metrica__valor">{valor}</span>
      <span className="metrica__etiqueta">{etiqueta}</span>
      {detalle && <span className="metrica__detalle">{detalle}</span>}
    </div>
  );
}

/** Barra apilada de trabajos por estado. */
export function Barra({ partes }: { partes: Array<{ valor: number; tono: string; titulo: string }> }): ReactNode {
  const total = partes.reduce((suma, p) => suma + p.valor, 0);
  if (total === 0) return <div className="barra barra--vacia" />;

  return (
    <div className="barra">
      {partes
        .filter((p) => p.valor > 0)
        .map((p) => (
          <div
            key={p.titulo}
            className={`barra__parte barra__parte--${p.tono}`}
            style={{ width: `${(p.valor / total) * 100}%` }}
            title={`${p.titulo}: ${p.valor}`}
          />
        ))}
    </div>
  );
}

export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function duracion(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
