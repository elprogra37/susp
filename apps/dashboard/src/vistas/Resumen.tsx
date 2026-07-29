import { useCallback, type ReactNode } from 'react';
import type { SuspClient } from '@susp/sdk';
import { useCarga } from '../api';
import { Barra, Estado, Insignia, Metrica, Panel, fecha } from '../ui';

/**
 * Primera pantalla: ¿está todo bien?
 *
 * Lo más importante arriba: si alguna app destino está caída o dejó de ser
 * conforme, se ve antes que cualquier métrica. Una campaña que corre contra una
 * app rota solo produce errores.
 */
export function Resumen({ cliente }: { cliente: SuspClient }): ReactNode {
  const apps = useCarga(() => cliente.listTargetApps({ limit: 100 }), [cliente], {
    refrescarCada: 15_000,
  });
  const campanas = useCarga(() => cliente.listCampaigns({ limit: 100 }), [cliente], {
    refrescarCada: 5_000,
  });
  const resumenAuditoria = useCarga(() => cliente.auditSummary(24), [cliente], {
    refrescarCada: 30_000,
  });

  const enCurso = campanas.datos?.items.filter((c) => c.status === 'RUNNING') ?? [];
  const conProblemas =
    apps.datos?.items.filter(
      (a) => a.health === 'UNREACHABLE' || a.health === 'NON_CONFORMANT' || a.health === 'DEGRADED',
    ) ?? [];

  const totales = (resumenAuditoria.datos ?? []).reduce(
    (acc, fila) => {
      acc.total += fila.count;
      if (fila.result === 'ERROR') acc.errores += fila.count;
      if (fila.result === 'REJECTED') acc.rechazos += fila.count;
      return acc;
    },
    { total: 0, errores: 0, rechazos: 0 },
  );

  return (
    <>
      {conProblemas.length > 0 && (
        <div className="alerta">
          <strong>Atención:</strong> {conProblemas.length}{' '}
          {conProblemas.length === 1 ? 'app destino tiene' : 'apps destino tienen'} problemas.{' '}
          {conProblemas.map((a) => a.name).join(', ')}. Una campaña contra una app así solo
          va a producir errores.
        </div>
      )}

      <div className="metricas">
        <Metrica etiqueta="Apps destino" valor={apps.datos?.total ?? '—'} />
        <Metrica
          etiqueta="Campañas en curso"
          valor={enCurso.length}
          detalle={`${campanas.datos?.total ?? 0} en total`}
        />
        <Metrica
          etiqueta="Operaciones (24 h)"
          valor={totales.total}
          detalle={
            totales.errores + totales.rechazos > 0
              ? `${totales.errores} errores · ${totales.rechazos} rechazos`
              : 'sin errores'
          }
        />
      </div>

      <Panel titulo="Apps destino">
        <Estado
          cargando={apps.cargando}
          error={apps.error}
          vacio={apps.datos?.items.length === 0}
        >
          <table className="tabla">
            <thead>
              <tr>
                <th>App</th>
                <th>Entorno</th>
                <th>Estado</th>
                <th>Capacidades</th>
                <th>Último chequeo</th>
              </tr>
            </thead>
            <tbody>
              {apps.datos?.items.map((app) => (
                <tr key={app.id}>
                  <td>
                    <a href="#/apps">{app.name}</a>
                    <span className="sutil"> /{app.slug}</span>
                  </td>
                  <td>
                    <Insignia valor={app.env} />
                    {app.env === 'PRODUCTION' && app.productionWritesAllowed && (
                      <Insignia valor="escrituras habilitadas" tono="mal" />
                    )}
                  </td>
                  <td>
                    <Insignia valor={app.health} />
                  </td>
                  <td className="sutil">{app.capabilities.length || '—'}</td>
                  <td className="sutil">{fecha(app.healthCheckedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Panel>

      <Panel titulo="Campañas recientes">
        <Estado
          cargando={campanas.cargando}
          error={campanas.error}
          vacio={campanas.datos?.items.length === 0}
        >
          <table className="tabla">
            <thead>
              <tr>
                <th>Campaña</th>
                <th>App</th>
                <th>Estado</th>
                <th>Agentes</th>
              </tr>
            </thead>
            <tbody>
              {campanas.datos?.items.slice(0, 10).map((c) => (
                <tr key={c.id}>
                  <td>
                    <a href={`#/campanas/${c.id}`}>{c.name}</a>
                    {c.dryRun && <Insignia valor="simulación" tono="aviso" />}
                  </td>
                  <td className="sutil">{c.targetApp?.name ?? '—'}</td>
                  <td>
                    <Insignia valor={c.status} />
                  </td>
                  <td className="sutil">{c._count?.agents ?? c.agentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Panel>

      <Panel titulo="Operaciones por resultado (últimas 24 h)">
        <Estado
          cargando={resumenAuditoria.cargando}
          error={resumenAuditoria.error}
          vacio={(resumenAuditoria.datos ?? []).length === 0}
        >
          <ResumenOperaciones filas={resumenAuditoria.datos ?? []} />
        </Estado>
      </Panel>
    </>
  );
}

function ResumenOperaciones({
  filas,
}: {
  filas: Array<{ operation: string; result: string; count: number; avgDurationMs: number | null }>;
}): ReactNode {
  const porOperacion = new Map<string, Array<(typeof filas)[number]>>();
  for (const fila of filas) {
    const lista = porOperacion.get(fila.operation) ?? [];
    lista.push(fila);
    porOperacion.set(fila.operation, lista);
  }

  return (
    <table className="tabla">
      <thead>
        <tr>
          <th>Operación</th>
          <th>Total</th>
          <th>Distribución</th>
          <th>Latencia media</th>
        </tr>
      </thead>
      <tbody>
        {[...porOperacion.entries()].map(([operacion, grupo]) => {
          const total = grupo.reduce((s, f) => s + f.count, 0);
          const conDuracion = grupo.filter((f) => f.avgDurationMs !== null);
          const media =
            conDuracion.length > 0
              ? Math.round(
                  conDuracion.reduce((s, f) => s + (f.avgDurationMs ?? 0) * f.count, 0) /
                    conDuracion.reduce((s, f) => s + f.count, 0),
                )
              : null;

          return (
            <tr key={operacion}>
              <td>
                <code>{operacion}</code>
              </td>
              <td>{total}</td>
              <td>
                <Barra
                  partes={grupo.map((f) => ({
                    valor: f.count,
                    titulo: f.result,
                    tono:
                      f.result === 'OK'
                        ? 'ok'
                        : f.result === 'ERROR'
                          ? 'mal'
                          : f.result === 'REJECTED'
                            ? 'aviso'
                            : 'neutro',
                  }))}
                />
              </td>
              <td className="sutil">{media === null ? '—' : `${media} ms`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
