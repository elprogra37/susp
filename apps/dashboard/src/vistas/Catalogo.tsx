import type { ReactNode } from 'react';
import type { SuspClient } from '@susp/sdk';
import { useCarga } from '../api';
import { Estado, Insignia, Panel } from '../ui';

/**
 * Personas y escenarios: el "quién" y el "qué hacen" de una simulación.
 *
 * Solo lectura por ahora. Editar rasgos y mezclas desde el navegador tiene
 * sentido, pero no antes de que exista el catálogo por vertical: es más útil
 * duplicar y ajustar uno existente que armar uno desde cero en un formulario.
 */
export function Catalogo({ cliente }: { cliente: SuspClient }): ReactNode {
  const personas = useCarga(() => cliente.listPersonas({ limit: 100 }), [cliente]);
  const escenarios = useCarga(() => cliente.listScenarios({ limit: 100 }), [cliente]);

  return (
    <>
      <Panel titulo="Personas">
        <Estado
          cargando={personas.cargando}
          error={personas.error}
          vacio={personas.datos?.items.length === 0}
        >
          <table className="tabla">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Vertical</th>
                <th>Rasgos destacados</th>
                <th>Intereses</th>
                <th>Objetivos</th>
              </tr>
            </thead>
            <tbody>
              {personas.datos?.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    {p.builtin && <Insignia valor="incorporada" tono="neutro" />}
                    {p.description && <div className="sutil">{p.description}</div>}
                  </td>
                  <td className="sutil">{p.vertical.toLowerCase()}</td>
                  <td className="sutil">{rasgosDestacados(p.traits)}</td>
                  <td className="sutil">{p.interests.slice(0, 4).join(', ') || '—'}</td>
                  <td className="sutil">{p.goals.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Panel>

      <Panel titulo="Escenarios">
        <Estado
          cargando={escenarios.cargando}
          error={escenarios.error}
          vacio={escenarios.datos?.items.length === 0}
        >
          <table className="tabla">
            <thead>
              <tr>
                <th>Escenario</th>
                <th>Vertical</th>
                <th>Mezcla de acciones</th>
                <th>Intensidad</th>
              </tr>
            </thead>
            <tbody>
              {escenarios.datos?.items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.name}</strong>
                    {e.builtin && <Insignia valor="incorporado" tono="neutro" />}
                    {e.description && <div className="sutil">{e.description}</div>}
                  </td>
                  <td className="sutil">{e.vertical.toLowerCase()}</td>
                  <td className="sutil">
                    {Object.entries(e.actionMix)
                      .map(([op, peso]) => `${op} ×${peso}`)
                      .join(' · ') || 'por defecto'}
                  </td>
                  <td className="sutil">{e.intensity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Panel>
    </>
  );
}

/** Solo los rasgos que se apartan del medio: son los que explican la conducta. */
function rasgosDestacados(traits: object): string {
  const nombres: Record<string, string> = {
    openness: 'apertura',
    conscientiousness: 'responsabilidad',
    extraversion: 'extraversión',
    agreeableness: 'amabilidad',
    neuroticism: 'neuroticismo',
    chattiness: 'locuacidad',
    riskTolerance: 'riesgo',
    formality: 'formalidad',
  };

  const destacados = Object.entries(traits)
    .filter((par): par is [string, number] => typeof par[1] === 'number')
    .filter(([, valor]) => Math.abs(valor - 0.5) > 0.2)
    .sort((a, b) => Math.abs(b[1] - 0.5) - Math.abs(a[1] - 0.5))
    .slice(0, 3)
    .map(([clave, valor]) => `${nombres[clave] ?? clave} ${valor > 0.5 ? 'alta' : 'baja'}`);

  return destacados.join(', ') || 'equilibrada';
}
