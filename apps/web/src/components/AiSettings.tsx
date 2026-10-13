'use client';

import { useCallback, useEffect, useState } from 'react';

type Model = { id: string; label: string };
type Listing = { models: Model[]; recommended: string; selected: string };

export default function AiSettings({ initialModel }: { initialModel: string | null }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [choice, setChoice] = useState(initialModel ?? '');
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (refresh: boolean) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/ai/models${refresh ? '?refresh=1' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao listar modelos');
      setListing(data);
      setActive(data.selected);
      setChoice((c) => (c && data.models.some((m: Model) => m.id === c) ? c : data.selected));
      if (refresh) setNotice('Lista de modelos atualizada.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao listar modelos');
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  async function save() {
    if (!listing) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // Escolher o recomendado grava "nenhuma preferência": ele acompanha o sistema.
      const model = choice === listing.recommended ? null : choice;
      const res = await fetch('/api/ai/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar');
      setActive(data.model);
      setNotice(`Configuração testada e salva: ${data.model}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar');
    }
    setBusy(false);
  }

  return (
    <div className="panel" style={{ maxWidth: 520 }}>
      <span className="kicker">Conta</span>
      <h2 style={{ marginTop: 4 }}>Integrações de IA</h2>
      <p className="muted">A chave da IA fica protegida no servidor e nunca aparece no navegador.</p>

      <div className="status">
        <span className={`statusdot${active ? ' on' : ''}`} />
        <div>
          <strong>Google Gemini</strong>
          <div className="muted">{active ?? 'carregando…'}</div>
        </div>
      </div>

      <label className="field topspace">
        Plataforma
        <select disabled value="gemini" aria-label="Plataforma">
          <option value="gemini">Google Gemini</option>
        </select>
      </label>

      <label className="field">
        Modelo
        <select value={choice} disabled={!listing || busy} onChange={(e) => setChoice(e.target.value)}>
          {listing?.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.id === listing.recommended ? ' — recomendado' : ''}
            </option>
          ))}
        </select>
        {listing && <small className="muted">Modelo recomendado no momento: {listing.recommended}</small>}
      </label>

      <p>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => load(true)}>
          Atualizar lista de modelos
        </button>{' '}
        <button type="button" className="btn" disabled={busy || !listing} onClick={save}>
          Salvar e testar configuração
        </button>
      </p>
      <p aria-live="polite">{notice}</p>
      <p className="error" role="alert">
        {error}
      </p>
    </div>
  );
}
