import { useState, type FormEvent, type ReactNode } from 'react';
import { iniciarSesion, type Sesion } from '../api';

export function Login({ onEntrar }: { onEntrar: (sesion: Sesion) => void }): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      onEntrar(await iniciarSesion(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login">
      <form className="login__caja" onSubmit={(e) => void enviar(e)}>
        <h1>SUSP</h1>
        <p className="login__bajada">Synthetic User Simulation Platform</p>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </label>

        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <p className="mensaje mensaje--error">{error}</p>}

        <button type="submit" className="boton boton--principal" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
