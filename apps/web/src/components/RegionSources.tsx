'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';

type Source = { id: string; label: string; url: string; verification_status: string; created_at: string };

export default function RegionSources({ tripId, regionId }: { tripId: string; regionId: string }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser()
      .from('travel_sources')
      .select('id,label,url,verification_status,created_at')
      .eq('trip_id', tripId)
      .eq('region_id', regionId)
      .order('created_at', { ascending: false });
    if (error) setError('Não foi possível carregar as fontes.');
    else setSources((data ?? []) as Source[]);
  }, [tripId, regionId]);

  useEffect(() => { void load(); }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/trips/${tripId}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regionId, label: label.trim(), url: url.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.');
      setLabel('');
      setUrl('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha de conexão.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="source-list">
      <strong>Fontes e links de hospedagem</strong>
      <p className="muted">
        Links adicionados manualmente não são verificados pelo sistema. Confirme valores e disponibilidade no site.
      </p>
      {sources.length > 0 && (
        <ul>
          {sources.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.label} ↗</a>
              <small className="muted"> · {s.verification_status === 'verified' ? 'Verificada' : 'Não verificada'} · adicionada em {new Date(s.created_at).toLocaleDateString('pt-BR')}</small>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={save} className="source-form">
        <label className="field">
          Nome da fonte
          <input value={label} maxLength={180} required placeholder="Ex.: Site de hospedagem"
            onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field">
          Link HTTPS
          <input value={url} type="url" pattern="https://.*" maxLength={2048} required
            placeholder="https://..." onChange={(e) => setUrl(e.target.value)} />
        </label>
        <button className="btn secondary" disabled={busy} type="submit">
          {busy ? 'Salvando…' : 'Adicionar fonte'}
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
