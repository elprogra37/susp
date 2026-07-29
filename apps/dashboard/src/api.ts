/**
 * Acceso a la API del motor desde el navegador.
 *
 * Envuelve `@susp/sdk` con lo que solo tiene sentido en un navegador: guardar la
 * sesión, y un pequeño hook para no repetir el patrón cargar/error/reintentar en
 * cada pantalla.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SuspClient, SuspError } from '@susp/sdk';

const API_URL =
  (import.meta.env.VITE_SUSP_API_URL as string | undefined) ??
  'http://localhost:55701/api/v1';

const STORAGE_KEY = 'susp.sesion';

export interface Sesion {
  token: string;
  tenant: { id: string; name: string; slug: string };
  member: { id: string; email: string; role: string };
  expiraEn: number;
}

export function leerSesion(): Sesion | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const sesion = JSON.parse(raw) as Sesion;
    // Una sesión vencida es lo mismo que no tener sesión: mejor descartarla acá
    // que dejar que cada petición falle con 401.
    if (sesion.expiraEn < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return sesion;
  } catch {
    return null;
  }
}

export function guardarSesion(sesion: Sesion): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sesion));
}

export function borrarSesion(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function clienteDe(sesion: Sesion): SuspClient {
  return new SuspClient({ baseUrl: API_URL, jwt: sesion.token });
}

export async function iniciarSesion(email: string, password: string): Promise<Sesion> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const texto = await response.text();
  if (!response.ok) {
    throw SuspError.fromResponse(response.status, texto);
  }

  const data = JSON.parse(texto) as {
    token: string;
    expiresIn: number;
    tenant: Sesion['tenant'];
    member: Sesion['member'];
  };

  const sesion: Sesion = {
    token: data.token,
    tenant: data.tenant,
    member: data.member,
    expiraEn: Date.now() + data.expiresIn * 1000,
  };
  guardarSesion(sesion);
  return sesion;
}

export interface EstadoCarga<T> {
  datos: T | null;
  cargando: boolean;
  error: string | null;
  recargar: () => void;
}

/**
 * Carga datos con recarga automática opcional.
 *
 * Una campaña en curso cambia cada pocos segundos, así que el dashboard sondea.
 * Se usa `setTimeout` encadenado y no `setInterval` por el mismo motivo que en el
 * scheduler: si una respuesta tarda más que el intervalo, no se apilan peticiones.
 */
export function useCarga<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  opciones: { refrescarCada?: number } = {},
): EstadoCarga<T> {
  const [datos, setDatos] = useState<T | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Se guarda en ref para que cambiar la función no dispare la recarga: si no,
  // una función creada en el render provocaría un bucle infinito.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const recargar = useCallback(() => setTick((valor) => valor + 1), []);

  useEffect(() => {
    let vigente = true;
    let timer: number | undefined;

    const ejecutar = async (): Promise<void> => {
      try {
        const resultado = await fnRef.current();
        if (!vigente) return;
        setDatos(resultado);
        setError(null);
      } catch (err) {
        if (!vigente) return;
        setError(
          err instanceof SuspError
            ? `${err.message}${err.code ? ` (${err.code})` : ''}`
            : String(err),
        );
      } finally {
        if (vigente) {
          setCargando(false);
          if (opciones.refrescarCada) {
            timer = window.setTimeout(() => void ejecutar(), opciones.refrescarCada);
          }
        }
      }
    };

    setCargando(true);
    void ejecutar();

    return () => {
      vigente = false;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, opciones.refrescarCada]);

  return { datos, cargando, error, recargar };
}
