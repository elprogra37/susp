import { useCallback, useState, type ReactNode } from 'react';
import type { SuspClient } from '@susp/sdk';
import { useCarga } from '../api';
import { Barra, Estado, Insignia, Metrica, Panel, duracion, fecha } from '../ui';

export function DetalleCampana({
  cliente,
  id,
  rol,
}: {
  cliente: SuspClient;
  id: string;
  rol: string;
}): ReactNode {
  const campana = useCarga(() => cliente.getCampaign(id), [cliente, id], {
    refrescarCada: 4_000,
  });
  const ejecuciones = useCarga(() => cliente.listRuns({ campaignId: id, limit: 20 }), [cliente, id], {
    refrescarCada: 4_000,
  });
  const agentes = useCarga(
    () => cliente.listAgents({ campaignId: id, limit: 50 }),
    [cliente, id],
    { refrescarCada: 6_000 },
  );

  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const accion = useCallback(
    async (fn: () => Promise<unknown>, mensaje?: string) => {
      setOcupado(true);
      setError(null);
      setAviso(null);
      try {
        await fn();
        if (mensaje) setAviso(mensaje);
        campana.recargar();
        ejecuciones.recargar();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setOcupado(false);
      }
    },
    [campana, ejecuciones],
  );

  const c = campana.datos;
  const ultima = ejecuciones.datos?.items[0];

  return (
    <>
      <p className="miga">
        <a href="#/campanas">← Campañas</a>
      </p>

      {error && <p className="mensaje mensaje--error">{error}</p>}
      {aviso && <p className="mensaje mensaje--ok">{aviso}</p>}

      <Estado cargando={campana.cargando} error={campana.error}>
        {c && (
          <>
            <Panel
              titulo={c.name}
              acciones={
                rol !== 'VIEWER' && (
                  <div className="acciones">
                    {(c.status === 'DRAFT' || c.status === 'PAUSED') && (
                      <>
                        <button
                          type="button"
                          className="boton"
                          disabled={ocupado}
                          onClick={() =>
                            void accion(
                              () => cliente.startCampaign(c.id, { dryRun: true }),
                              'Simulación encolada: se va a calcular el plan sin escribir nada.',
                            )
                          }
                        >
                          Simular
                        </button>
                        <button
                          type="button"
                          className="boton boton--principal"
                          disabled={ocupado}
                          onClick={() =>
                            void accion(() => cliente.startCampaign(c.id), 'Ejecución encolada.')
                          }
                        >
                          Arrancar
                        </button>
                      </>
                    )}
                    {c.status === 'RUNNING' && (
                      <button
                        type="button"
                        className="boton"
                        disabled={ocupado}
                        onClick={() => void accion(() => cliente.pauseCampaign(c.id), 'Pausada.')}
                      >
                        Pausar
                      </button>
                    )}
                    {['RUNNING', 'PAUSED', 'SCHEDULED'].includes(c.status) && (
                      <button
                        type="button"
                        className="boton"
                        disabled={ocupado}
                        onClick={() => void accion(() => cliente.cancelCampaign(c.id), 'Cancelada.')}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                )
              }
            >
              <div className="metricas">
                <Metrica etiqueta="Estado" valor={<Insignia valor={c.status} />} />
                <Metrica etiqueta="Agentes" valor={`${c._count?.agents ?? 0} / ${c.agentCount}`} />
                <Metrica etiqueta="Reloj simulado" valor={`×${c.timeScale}`} />
                <Metrica
                  etiqueta="App destino"
                  valor={c.targetApp?.name ?? '—'}
                  detalle={c.targetApp?.env.toLowerCase()}
                />
              </div>

              {c.dryRun && (
                <p className="mensaje mensaje--aviso">
                  Esta campaña está en modo simulación: calcula todo el plan pero no escribe nada
                  en la app destino.
                </p>
              )}
            </Panel>

            {ultima && <ProgresoEjecucion cliente={cliente} runId={ultima.id} />}

            <Panel titulo="Ejecuciones">
              <Estado
                cargando={ejecuciones.cargando}
                error={ejecuciones.error}
                vacio={ejecuciones.datos?.items.length === 0}
              >
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Ejecución</th>
                      <th>Estado</th>
                      <th>Trabajos</th>
                      <th>Arrancó</th>
                      <th>Terminó</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ejecuciones.datos?.items.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <code className="sutil">{r.id.slice(0, 12)}</code>
                          {r.dryRun && <Insignia valor="simulación" tono="aviso" />}
                        </td>
                        <td>
                          <Insignia valor={r.status} />
                        </td>
                        <td className="sutil">
                          {r.jobsSucceeded}/{r.jobsTotal}
                          {r.jobsFailed > 0 && (
                            <span className="mal"> · {r.jobsFailed} fallidos</span>
                          )}
                        </td>
                        <td className="sutil">{fecha(r.startedAt)}</td>
                        <td className="sutil">{fecha(r.finishedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Estado>
            </Panel>

            <Panel titulo="Agentes">
              <Estado
                cargando={agentes.cargando}
                error={agentes.error}
                vacio={agentes.datos?.items.length === 0}
              >
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Agente</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                      <th>Objetivos</th>
                      <th>Última actividad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentes.datos?.items.map((a) => {
                      const cumplidos = a.goals.filter((g) => g.done).length;
                      return (
                        <tr key={a.id}>
                          <td>
                            <strong>{a.displayName}</strong>
                            <div className="sutil">
                              @{a.handle}
                              {a.externalUserId ? ` · ${a.externalUserId.slice(0, 16)}` : ' · sin registrar'}
                            </div>
                          </td>
                          <td>
                            <Insignia valor={a.status} />
                          </td>
                          <td className="sutil">
                            {a.actionCount}
                            {a.errorCount > 0 && <span className="mal"> · {a.errorCount} err</span>}
                          </td>
                          <td className="sutil">
                            {a.goals.length === 0 ? '—' : `${cumplidos}/${a.goals.length}`}
                          </td>
                          <td className="sutil">{fecha(a.lastActedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Estado>
            </Panel>

            {rol === 'OWNER' && <PanelPurga cliente={cliente} campana={c} onPurgado={campana.recargar} />}
          </>
        )}
      </Estado>
    </>
  );
}

function ProgresoEjecucion({
  cliente,
  runId,
}: {
  cliente: SuspClient;
  runId: string;
}): ReactNode {
  const run = useCarga(() => cliente.getRun(runId), [cliente, runId], { refrescarCada: 3_000 });

  return (
    <Panel titulo="Última ejecución">
      <Estado cargando={run.cargando} error={run.error}>
        {run.datos && (
          <>
            <Barra
              partes={[
                { valor: run.datos.jobsByStatus.SUCCEEDED ?? 0, tono: 'ok', titulo: 'ok' },
                { valor: run.datos.jobsByStatus.RUNNING ?? 0, tono: 'activo', titulo: 'en curso' },
                { valor: run.datos.jobsByStatus.PENDING ?? 0, tono: 'neutro', titulo: 'pendientes' },
                { valor: run.datos.jobsByStatus.FAILED ?? 0, tono: 'mal', titulo: 'fallidos' },
                { valor: run.datos.jobsByStatus.DEAD ?? 0, tono: 'mal', titulo: 'muertos' },
              ]}
            />

            <table className="tabla">
              <thead>
                <tr>
                  <th>Operación</th>
                  <th>Cantidad</th>
                  <th>Latencia media</th>
                </tr>
              </thead>
              <tbody>
                {run.datos.jobsByOperation.map((o) => (
                  <tr key={o.operation}>
                    <td>
                      <code>{o.operation}</code>
                    </td>
                    <td>{o.count}</td>
                    <td className="sutil">{duracion(o.avgDurationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {run.datos.error && <p className="mensaje mensaje--error">{run.datos.error}</p>}
          </>
        )}
      </Estado>
    </Panel>
  );
}

/**
 * Purga: la operación más delicada del sistema.
 *
 * Pide el nombre exacto de la campaña, y ofrece primero el simulacro. La
 * fricción es deliberada — borra datos en un sistema ajeno.
 */
function PanelPurga({
  cliente,
  campana,
  onPurgado,
}: {
  cliente: SuspClient;
  campana: { id: string; name: string; status: string };
  onPurgado: () => void;
}): ReactNode {
  const [nombre, setNombre] = useState('');
  const [resultado, setResultado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function purgar(simulacro: boolean): Promise<void> {
    setOcupado(true);
    setError(null);
    setResultado(null);
    try {
      const r = await cliente.purgeCampaign(campana.id, {
        confirmName: nombre,
        dryRun: simulacro,
      });
      const detalle = Object.entries(r.purged)
        .map(([tipo, cantidad]) => `${cantidad} ${tipo}`)
        .join(', ');
      setResultado(
        simulacro
          ? `Se borrarían: ${detalle || 'nada'}.`
          : `Borrado: ${detalle || 'nada'}. Quedan ${r.mirroredEntities} entidades sin purgar.`,
      );
      if (!simulacro) {
        setNombre('');
        onPurgado();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="panel panel--peligro">
      <header className="panel__cabecera">
        <h2>Purgar datos generados</h2>
      </header>

      <p>
        Borra en la app destino <strong>todo lo que generó esta campaña</strong>, y nada más.
        La app solo puede borrar entidades marcadas como sintéticas, así que ningún dato real
        está en riesgo — pero la acción no se puede deshacer.
      </p>

      {campana.status === 'RUNNING' && (
        <p className="mensaje mensaje--aviso">
          La campaña está en curso. Pausala o cancelala antes de purgar.
        </p>
      )}

      <label>
        Para confirmar, escribí el nombre exacto de la campaña
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={campana.name} />
      </label>

      {error && <p className="mensaje mensaje--error">{error}</p>}
      {resultado && <p className="mensaje mensaje--ok">{resultado}</p>}

      <div className="acciones">
        <button
          type="button"
          className="boton"
          disabled={ocupado || nombre.length === 0}
          onClick={() => void purgar(true)}
        >
          Simular purga
        </button>
        <button
          type="button"
          className="boton boton--peligro"
          disabled={ocupado || nombre !== campana.name || campana.status === 'RUNNING'}
          onClick={() => void purgar(false)}
        >
          Purgar de verdad
        </button>
      </div>
    </section>
  );
}
