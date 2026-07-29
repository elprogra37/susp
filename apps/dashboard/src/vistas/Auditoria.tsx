import { useState, type ReactNode } from 'react';
import type { SuspClient } from '@susp/sdk';
import { useCarga } from '../api';
import { Estado, Insignia, Panel, duracion, fecha } from '../ui';

/**
 * Registro append-only de todo lo que el motor hizo contra cada app destino.
 *
 * Es la vista que responde "¿qué pasó?" cuando algo salió mal, así que el filtro
 * por resultado está a mano: casi siempre se entra buscando los errores.
 */
export function Auditoria({ cliente }: { cliente: SuspClient }): ReactNode {
  const [resultado, setResultado] = useState('');
  const [operacion, setOperacion] = useState('');

  const eventos = useCarga(
    () =>
      cliente.listAudit({
        limit: 100,
        result: resultado || undefined,
        operation: operacion || undefined,
      }),
    [cliente, resultado, operacion],
    { refrescarCada: 8_000 },
  );

  return (
    <Panel
      titulo="Auditoría"
      acciones={
        <div className="filtros">
          <select value={resultado} onChange={(e) => setResultado(e.target.value)}>
            <option value="">Todos los resultados</option>
            <option value="OK">Solo correctas</option>
            <option value="ERROR">Solo errores</option>
            <option value="REJECTED">Solo rechazos</option>
            <option value="DRY_RUN">Solo simulaciones</option>
          </select>
          <input
            placeholder="Filtrar por operación…"
            value={operacion}
            onChange={(e) => setOperacion(e.target.value)}
          />
        </div>
      }
    >
      <Estado
        cargando={eventos.cargando}
        error={eventos.error}
        vacio={eventos.datos?.items.length === 0}
      >
        <table className="tabla tabla--compacta">
          <thead>
            <tr>
              <th>Momento</th>
              <th>Operación</th>
              <th>Resultado</th>
              <th>Duración</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {eventos.datos?.items.map((e) => (
              <tr key={e.id}>
                <td className="sutil">{fecha(e.at)}</td>
                <td>
                  <code>{e.operation}</code>
                  <div className="sutil">{e.actor}</div>
                </td>
                <td>
                  <Insignia valor={e.result} />
                  {e.httpStatus && <span className="sutil"> {e.httpStatus}</span>}
                </td>
                <td className="sutil">{duracion(e.durationMs)}</td>
                <td className="sutil">{e.message ?? (e.entityId ? e.entityId : '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Estado>
    </Panel>
  );
}
