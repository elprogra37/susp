/**
 * Prueba de humo de renderizado.
 *
 * Que TypeScript compile y que Vite transforme los módulos no dice nada sobre
 * si las vistas **renderizan**: un `.map` sobre algo indefinido o un hook mal
 * usado explotan recién en el navegador. Renderizarlas atrapa esa clase de
 * error sin necesidad de un navegador.
 *
 * Corre con Vitest y no con el runner de Node porque las vistas son `.tsx`: el
 * runtime de Node quita tipos pero no transforma JSX.
 *
 *   npm test -w @susp/dashboard
 */

import { test, assert } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import type { SuspClient } from '@susp/sdk';

import { Login } from './vistas/Login.tsx';
import { Resumen } from './vistas/Resumen.tsx';
import { Apps } from './vistas/Apps.tsx';
import { Campanas } from './vistas/Campanas.tsx';
import { DetalleCampana } from './vistas/DetalleCampana.tsx';
import { Catalogo } from './vistas/Catalogo.tsx';
import { Auditoria } from './vistas/Auditoria.tsx';
import { Barra, Insignia, Metrica, duracion, fecha } from './ui.tsx';

/**
 * Cliente que nunca resuelve: deja a las vistas en su estado de carga, que es
 * el que se verifica acá. El camino con datos se prueba contra el motor real.
 */
const cliente = new Proxy({} as SuspClient, {
  get: () => () => new Promise(() => undefined),
});

test('las vistas renderizan sin romperse', () => {
  const vistas: Array<[string, () => string]> = [
    ['Login', () => renderToString(h(Login, { onEntrar: () => undefined }))],
    ['Resumen', () => renderToString(h(Resumen, { cliente }))],
    ['Apps', () => renderToString(h(Apps, { cliente, rol: 'OWNER' }))],
    ['Campanas', () => renderToString(h(Campanas, { cliente }))],
    [
      'DetalleCampana',
      () => renderToString(h(DetalleCampana, { cliente, id: 'camp_1', rol: 'OWNER' })),
    ],
    ['Catalogo', () => renderToString(h(Catalogo, { cliente }))],
    ['Auditoria', () => renderToString(h(Auditoria, { cliente }))],
  ];

  for (const [nombre, render] of vistas) {
    assert.ok(render().length > 0, `${nombre} renderizó vacío`);
  }
});

test('el login muestra sus campos', () => {
  const html = renderToString(h(Login, { onEntrar: () => undefined }));
  assert.match(html, /type="email"/);
  assert.match(html, /type="password"/);
  assert.match(html, /Entrar/);
});

test('la insignia traduce los enums del motor', () => {
  assert.match(renderToString(h(Insignia, { valor: 'HEALTHY' })), /sana/);
  assert.match(renderToString(h(Insignia, { valor: 'NON_CONFORMANT' })), /no conforme/);
  assert.match(renderToString(h(Insignia, { valor: 'RUNNING' })), /en curso/);
  // Un valor desconocido no debe romper: se muestra tal cual, en minúsculas.
  assert.match(renderToString(h(Insignia, { valor: 'ALGO_NUEVO' })), /algo_nuevo/);
});

test('la insignia elige el tono por significado', () => {
  assert.match(renderToString(h(Insignia, { valor: 'HEALTHY' })), /insignia--ok/);
  assert.match(renderToString(h(Insignia, { valor: 'FAILED' })), /insignia--mal/);
  assert.match(renderToString(h(Insignia, { valor: 'PRODUCTION' })), /insignia--aviso/);
  assert.match(renderToString(h(Insignia, { valor: 'RUNNING' })), /insignia--activo/);
});

test('la barra reparte el ancho y no divide por cero', () => {
  assert.match(renderToString(h(Barra, { partes: [] })), /barra--vacia/);

  const llena = renderToString(
    h(Barra, {
      partes: [
        { valor: 3, tono: 'ok', titulo: 'ok' },
        { valor: 1, tono: 'mal', titulo: 'fallidos' },
      ],
    }),
  );
  assert.match(llena, /75%/);
  assert.match(llena, /25%/);
});

test('la métrica acepta un nodo además de un número', () => {
  assert.match(renderToString(h(Metrica, { etiqueta: 'Estado', valor: 42 })), /42/);
  assert.match(
    renderToString(
      h(Metrica, { etiqueta: 'Estado', valor: h(Insignia, { valor: 'RUNNING' }) }),
    ),
    /en curso/,
  );
});

test('los formateadores toleran nulos', () => {
  assert.equal(fecha(null), '—');
  assert.equal(fecha(undefined), '—');
  assert.equal(duracion(null), '—');
  assert.equal(duracion(450), '450 ms');
  assert.equal(duracion(1500), '1.5 s');
});
