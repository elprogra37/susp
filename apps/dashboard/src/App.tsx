import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { borrarSesion, clienteDe, leerSesion, type Sesion } from './api';
import { Login } from './vistas/Login';
import { Resumen } from './vistas/Resumen';
import { Apps } from './vistas/Apps';
import { Campanas } from './vistas/Campanas';
import { DetalleCampana } from './vistas/DetalleCampana';
import { Catalogo } from './vistas/Catalogo';
import { Auditoria } from './vistas/Auditoria';

/**
 * Ruteo por hash, escrito a mano.
 *
 * Son siete pantallas: una librería de routing pesaría más que esto y no
 * aportaría nada. El hash además evita tener que configurar el servidor para
 * servir el index en cualquier ruta.
 */
type Ruta =
  | { vista: 'resumen' }
  | { vista: 'apps' }
  | { vista: 'campanas' }
  | { vista: 'campana'; id: string }
  | { vista: 'catalogo' }
  | { vista: 'auditoria' };

function parsearHash(): Ruta {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [seccion, id] = hash.split('/');

  switch (seccion) {
    case 'apps':
      return { vista: 'apps' };
    case 'campanas':
      return id ? { vista: 'campana', id } : { vista: 'campanas' };
    case 'catalogo':
      return { vista: 'catalogo' };
    case 'auditoria':
      return { vista: 'auditoria' };
    default:
      return { vista: 'resumen' };
  }
}

export function App(): ReactNode {
  const [sesion, setSesion] = useState<Sesion | null>(() => leerSesion());
  const [ruta, setRuta] = useState<Ruta>(() => parsearHash());

  useEffect(() => {
    const alCambiar = (): void => setRuta(parsearHash());
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  const salir = useCallback(() => {
    borrarSesion();
    setSesion(null);
    window.location.hash = '';
  }, []);

  // El cliente se memoiza por token: recrearlo en cada render dispararía las
  // recargas de todas las vistas que lo tienen como dependencia.
  const cliente = useMemo(() => (sesion ? clienteDe(sesion) : null), [sesion?.token]);

  if (!sesion || !cliente) {
    return <Login onEntrar={setSesion} />;
  }

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav__marca">
          <strong>SUSP</strong>
          <span className="nav__tenant">{sesion.tenant.name}</span>
        </div>

        <ul className="nav__enlaces">
          <Enlace a="" actual={ruta.vista} vista="resumen" texto="Resumen" />
          <Enlace a="apps" actual={ruta.vista} vista="apps" texto="Apps destino" />
          <Enlace a="campanas" actual={ruta.vista} vista="campanas" texto="Campañas" />
          <Enlace a="catalogo" actual={ruta.vista} vista="catalogo" texto="Personas y escenarios" />
          <Enlace a="auditoria" actual={ruta.vista} vista="auditoria" texto="Auditoría" />
        </ul>

        <div className="nav__usuario">
          <span>{sesion.member.email}</span>
          <button type="button" className="boton boton--sutil" onClick={salir}>
            Salir
          </button>
        </div>
      </nav>

      <main className="contenido">
        {ruta.vista === 'resumen' && <Resumen cliente={cliente} />}
        {ruta.vista === 'apps' && <Apps cliente={cliente} rol={sesion.member.role} />}
        {ruta.vista === 'campanas' && <Campanas cliente={cliente} />}
        {ruta.vista === 'campana' && (
          <DetalleCampana cliente={cliente} id={ruta.id} rol={sesion.member.role} />
        )}
        {ruta.vista === 'catalogo' && <Catalogo cliente={cliente} />}
        {ruta.vista === 'auditoria' && <Auditoria cliente={cliente} />}
      </main>
    </div>
  );
}

function Enlace({
  a,
  actual,
  vista,
  texto,
}: {
  a: string;
  actual: string;
  vista: string;
  texto: string;
}): ReactNode {
  const activo = actual === vista || (vista === 'campanas' && actual === 'campana');
  return (
    <li>
      <a href={`#/${a}`} className={activo ? 'activo' : undefined}>
        {texto}
      </a>
    </li>
  );
}
