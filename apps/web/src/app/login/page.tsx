'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const redirectTo = () => window.location.origin + '/auth/callback';

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo() },
    });
    setMessage(error?.message ?? 'Confira seu e-mail para acessar.');
    setLoading(false);
  }

  async function google() {
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo() },
    });
    if (error) setMessage(error.message);
  }

  return (
    <main className="panel" style={{ maxWidth: 480 }}>
      <h1>Entrar</h1>
      <p className="muted">Enviaremos um link de acesso ao seu e-mail ou entre com o Google.</p>
      <form onSubmit={sendLink}>
        <label className="field">
          E-mail
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button disabled={loading} className="btn">
          {loading ? 'Enviando...' : 'Enviar link'}
        </button>
      </form>
      <p>
        <button type="button" className="btn secondary" onClick={google}>
          Entrar com Google
        </button>
      </p>
      <p aria-live="polite">{message}</p>
    </main>
  );
}
