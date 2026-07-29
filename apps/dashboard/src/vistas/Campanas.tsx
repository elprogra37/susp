import { useState, type FormEvent, type ReactNode } from 'react';
import type { SuspClient } from '@susp/sdk';
import { useCarga } from '../api';
import { Estado, Insignia, Panel, fecha } from '../ui';

export function Campanas({ cliente }: { cliente: SuspClient }): ReactNode {
  const campanas = useCarga(() => cliente.listCampaigns({ limit: 100 }), [cliente], {
    refrescarCada: 5_000,
  });
  const apps = useCarga(() => cliente.listTargetApps({ limit: 100 }), [cliente]);
  const escenarios = useCarga(() => cliente.listScenarios({ limit: 100 }), [cliente]);
  const personas = useCarga(() => cliente.listPersonas({ limit: 100 }), [cliente]);

  const [creando, setCreando] = useState(false);

  return (
    <Panel
      titulo="Campañas"
      acciones={
        <button
          type="button"
          className="boton boton--principal"
          onClick={() => setCreando((v) => !v)}
        >
          {creando ? 'Cancelar' : 'Nueva campaña'}
        </button>
      }
    >
      {creando && (
        <FormularioCampana
          cliente={cliente}
          apps={apps.datos?.items ?? []}
          escenarios={escenarios.datos?.items ?? []}
          personas={personas.datos?.items ?? []}
          onListo={() => {
            setCreando(false);
            campanas.recargar();
          }}
        />
      )}

      <Estado
        cargando={campanas.cargando}
        error={campanas.error}
        vacio={campanas.datos?.items.length === 0}
      >
        <table className="tabla">
          <thead>
            <tr>
              <th>Campaña</th>
              <th>App destino</th>
              <th>Estado</th>
              <th>Agentes</th>
              <th>Ejecuciones</th>
              <th>Creada</th>
            </tr>
          </thead>
          <tbody>
            {campanas.datos?.items.map((c) => (
              <tr key={c.id}>
                <td>
                  <a href={`#/campanas/${c.id}`}>
                    <strong>{c.name}</strong>
                  </a>
                  {c.dryRun && <Insignia valor="simulación" tono="aviso" />}
                  {c.timeScale !== 1 && (
                    <span className="sutil"> · reloj ×{c.timeScale}</span>
                  )}
                </td>
                <td>
                  {c.targetApp?.name ?? '—'}
                  {c.targetApp?.env === 'PRODUCTION' && (
                    <Insignia valor="PRODUCTION" tono="aviso" />
                  )}
                </td>
                <td>
                  <Insignia valor={c.status} />
                </td>
                <td className="sutil">
                  {c._count?.agents ?? 0} / {c.agentCount}
                </td>
                <td className="sutil">{c._count?.runs ?? 0}</td>
                <td className="sutil">{fecha(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Estado>
    </Panel>
  );
}

function FormularioCampana({
  cliente,
  apps,
  escenarios,
  personas,
  onListo,
}: {
  cliente: SuspClient;
  apps: Array<{ id: string; name: string; env: string; health: string }>;
  escenarios: Array<{ id: string; name: string }>;
  personas: Array<{ id: string; name: string }>;
  onListo: () => void;
}): ReactNode {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    setEnviando(true);
    setError(null);

    try {
      const seleccionadas = datos.getAll('personaIds').map(String).filter(Boolean);
      await cliente.createCampaign({
        name: String(datos.get('name')),
        targetAppId: String(datos.get('targetAppId')),
        scenarioId: String(datos.get('scenarioId')) || undefined,
        agentCount: Number(datos.get('agentCount')),
        timeScale: Number(datos.get('timeScale')),
        dryRun: datos.get('dryRun') === 'on',
        personaIds: seleccionadas.length > 0 ? seleccionadas : undefined,
      });
      onListo();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  const sanas = apps.filter((a) => a.health === 'HEALTHY');

  return (
    <form className="formulario" onSubmit={(e) => void enviar(e)}>
      {sanas.length === 0 && (
        <p className="mensaje mensaje--aviso">
          No hay ninguna app destino verificada como sana. Verificala en “Apps destino”
          antes de crear una campaña: si no, la ejecución va a fallar apenas arranque.
        </p>
      )}

      <label>
        Nombre
        <input name="name" required minLength={2} placeholder="Demo para la reunión del jueves" />
      </label>

      <div className="formulario__fila">
        <label>
          App destino
          <select name="targetAppId" required defaultValue="">
            <option value="" disabled>
              Elegí una…
            </option>
            {apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name} ({app.env.toLowerCase()}){app.health !== 'HEALTHY' ? ' — sin verificar' : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          Escenario
          <select name="scenarioId" defaultValue="">
            <option value="">Sin escenario (mezcla por defecto)</option>
            {escenarios.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="formulario__fila">
        <label>
          Cantidad de agentes
          <input name="agentCount" type="number" min={1} max={5000} defaultValue={20} required />
        </label>

        <label>
          Aceleración del reloj
          <input name="timeScale" type="number" min={1} max={3600} defaultValue={60} />
          <span className="sutil">
            60 = una hora simulada por minuto real. Sirve para que los agentes lleguen a su
            horario activo sin esperar.
          </span>
        </label>
      </div>

      <fieldset className="formulario__grupo">
        <legend>Personas (vacío = las del vertical de la app)</legend>
        <div className="casillas">
          {personas.map((p) => (
            <label key={p.id} className="casilla">
              <input type="checkbox" name="personaIds" value={p.id} />
              {p.name}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="casilla">
        <input type="checkbox" name="dryRun" defaultChecked />
        Modo simulación — calcula el plan completo sin escribir nada en la app destino
      </label>

      {error && <p className="mensaje mensaje--error">{error}</p>}

      <button type="submit" className="boton boton--principal" disabled={enviando}>
        {enviando ? 'Creando…' : 'Crear campaña'}
      </button>
    </form>
  );
}
