import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import type { SuspClient, TargetApp } from '@susp/sdk';
import { useCarga } from '../api';
import { Estado, Insignia, Panel, fecha } from '../ui';

/**
 * Apps destino: alta, chequeo de salud y la salvaguarda de producción.
 *
 * El botón que habilita escrituras contra producción está deliberadamente
 * incómodo: exige escribir el slug exacto y una frase textual. No es un
 * ajuste más, es el permiso para que agentes generados escriban en un entorno
 * donde hay usuarios reales.
 */
export function Apps({ cliente, rol }: { cliente: SuspClient; rol: string }): ReactNode {
  const apps = useCarga(() => cliente.listTargetApps({ limit: 100 }), [cliente]);
  const [creando, setCreando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chequear = useCallback(
    async (id: string) => {
      setOcupado(id);
      setError(null);
      try {
        await cliente.checkTargetAppHealth(id);
        apps.recargar();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setOcupado(null);
      }
    },
    [cliente, apps],
  );

  return (
    <>
      {error && <p className="mensaje mensaje--error">{error}</p>}

      <Panel
        titulo="Apps destino"
        acciones={
          rol !== 'VIEWER' && (
            <button
              type="button"
              className="boton boton--principal"
              onClick={() => setCreando((v) => !v)}
            >
              {creando ? 'Cancelar' : 'Registrar app'}
            </button>
          )
        }
      >
        {creando && (
          <FormularioApp
            cliente={cliente}
            onListo={() => {
              setCreando(false);
              apps.recargar();
            }}
          />
        )}

        <Estado cargando={apps.cargando} error={apps.error} vacio={apps.datos?.items.length === 0}>
          <table className="tabla">
            <thead>
              <tr>
                <th>App</th>
                <th>URL de USI</th>
                <th>Entorno</th>
                <th>Estado</th>
                <th>Verificada</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {apps.datos?.items.map((app) => (
                <tr key={app.id}>
                  <td>
                    <strong>{app.name}</strong>
                    <div className="sutil">/{app.slug} · {app.vertical.toLowerCase()}</div>
                  </td>
                  <td className="sutil">
                    <code>{app.baseUrl}</code>
                    {app.usiVersion && <div>USI {app.usiVersion}</div>}
                  </td>
                  <td>
                    <Insignia valor={app.env} />
                  </td>
                  <td>
                    <Insignia valor={app.health} />
                    {app.healthDetail && <div className="sutil">{app.healthDetail}</div>}
                  </td>
                  <td className="sutil">{fecha(app.healthCheckedAt)}</td>
                  <td className="acciones">
                    <button
                      type="button"
                      className="boton"
                      disabled={ocupado === app.id || rol === 'VIEWER'}
                      onClick={() => void chequear(app.id)}
                    >
                      {ocupado === app.id ? 'Verificando…' : 'Verificar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Panel>

      {apps.datos?.items
        .filter((app) => app.env === 'PRODUCTION')
        .map((app) => (
          <ProduccionPanel
            key={app.id}
            app={app}
            cliente={cliente}
            rol={rol}
            onCambio={apps.recargar}
          />
        ))}
    </>
  );
}

function FormularioApp({
  cliente,
  onListo,
}: {
  cliente: SuspClient;
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
      await cliente.createTargetApp({
        name: String(datos.get('name')),
        slug: String(datos.get('slug')),
        baseUrl: String(datos.get('baseUrl')),
        env: datos.get('env') as 'DEVELOPMENT',
        vertical: datos.get('vertical') as 'SOCIAL',
        token: String(datos.get('token')),
      });
      onListo();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="formulario" onSubmit={(e) => void enviar(e)}>
      <div className="formulario__fila">
        <label>
          Nombre
          <input name="name" required minLength={2} placeholder="Nocturna" />
        </label>
        <label>
          Slug
          <input name="slug" required pattern="[a-z0-9][a-z0-9-]+[a-z0-9]" placeholder="nocturna" />
        </label>
      </div>

      <label>
        URL base de la API USI
        <input
          name="baseUrl"
          type="url"
          required
          placeholder="https://proyecto.supabase.co/functions/v1/usi/usi/v1"
        />
      </label>

      <div className="formulario__fila">
        <label>
          Entorno
          <select name="env" defaultValue="DEVELOPMENT">
            <option value="DEVELOPMENT">Desarrollo</option>
            <option value="STAGING">Staging</option>
            <option value="PRODUCTION">Producción</option>
          </select>
        </label>
        <label>
          Vertical
          <select name="vertical" defaultValue="SOCIAL">
            <option value="SOCIAL">Red social</option>
            <option value="DATING">Citas</option>
            <option value="TELEMEDICINE">Telemedicina</option>
            <option value="MARKETPLACE">Marketplace</option>
            <option value="OTHER">Otro</option>
          </select>
        </label>
      </div>

      <label>
        Token de la app
        <input name="token" type="password" required minLength={8} />
        <span className="sutil">
          Se guarda cifrado y no vuelve a mostrarse. Es el que espera tu API USI.
        </span>
      </label>

      {error && <p className="mensaje mensaje--error">{error}</p>}

      <button type="submit" className="boton boton--principal" disabled={enviando}>
        {enviando ? 'Guardando…' : 'Registrar'}
      </button>
    </form>
  );
}

/**
 * Panel aparte y con estilo de advertencia: habilitar escrituras contra
 * producción no debería sentirse como cambiar una preferencia.
 */
function ProduccionPanel({
  app,
  cliente,
  rol,
  onCambio,
}: {
  app: TargetApp;
  cliente: SuspClient;
  rol: string;
  onCambio: () => void;
}): ReactNode {
  const [slug, setSlug] = useState('');
  const [frase, setFrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function cambiar(permitir: boolean): Promise<void> {
    setEnviando(true);
    setError(null);
    try {
      await cliente.setProductionWrites(app.id, {
        allow: permitir,
        confirmSlug: slug,
        confirmPhrase: frase as 'ENTIENDO EL RIESGO',
      });
      setSlug('');
      setFrase('');
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="panel panel--peligro">
      <header className="panel__cabecera">
        <h2>Producción — {app.name}</h2>
        <Insignia
          valor={app.productionWritesAllowed ? 'escrituras habilitadas' : 'escrituras bloqueadas'}
          tono={app.productionWritesAllowed ? 'mal' : 'ok'}
        />
      </header>

      <p>
        Esta app está marcada como <strong>producción</strong>. Con las escrituras bloqueadas,
        el motor se niega a crear nada en ella. Habilitarlas significa que agentes sintéticos
        van a escribir en un entorno donde hay usuarios reales.
      </p>

      {rol !== 'OWNER' ? (
        <p className="sutil">Solo el rol OWNER puede cambiar esto.</p>
      ) : (
        <>
          <div className="formulario__fila">
            <label>
              Escribí el slug exacto de la app
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder={app.slug}
              />
            </label>
            <label>
              Escribí: ENTIENDO EL RIESGO
              <input value={frase} onChange={(e) => setFrase(e.target.value)} />
            </label>
          </div>

          {error && <p className="mensaje mensaje--error">{error}</p>}

          <div className="acciones">
            {app.productionWritesAllowed ? (
              <button
                type="button"
                className="boton"
                disabled={enviando}
                onClick={() => void cambiar(false)}
              >
                Volver a bloquear
              </button>
            ) : (
              <button
                type="button"
                className="boton boton--peligro"
                disabled={enviando}
                onClick={() => void cambiar(true)}
              >
                Habilitar escrituras en producción
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
