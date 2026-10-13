'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';

type Companion = {
  id: string;
  display_name: string;
  pace: 'relaxed'|'balanced'|'intense'|null;
  diet: string|null;
  mobility: string|null;
  avoid_times: string|null;
  must_have: string;
};
type Pace = 'relaxed'|'balanced'|'intense';
const labels: Record<Pace,string> = { relaxed:'Tranquilo', balanced:'Equilibrado', intense:'Intenso' };

export default function CompanionsSection({
  tripId, travelerCount, ownerPace, isOwner, onChanged,
}: {
  tripId: string; travelerCount: number; ownerPace: string|null;
  isOwner: boolean; onChanged: () => Promise<void>;
}) {
  const [people, setPeople] = useState<Companion[]>([]);
  const [name, setName] = useState('');
  const [pace, setPace] = useState<Pace>('balanced');
  const [diet, setDiet] = useState('');
  const [mobility, setMobility] = useState('');
  const [avoid, setAvoid] = useState('');
  const [mustHave, setMustHave] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().from('travel_companions')
      .select('id,display_name,pace,diet,mobility,avoid_times,must_have')
      .eq('trip_id',tripId).order('created_at');
    if (error) setError('Não foi possível carregar os acompanhantes.');
    else setPeople((data ?? []) as Companion[]);
  },[tripId]);
  useEffect(() => { void load(); },[load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/trips/${tripId}/companions`, {
        method: 'POST', headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          display_name:name, pace, diet:diet || null, mobility:mobility || null,
          avoid_times:avoid || null, must_have:mustHave,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Erro ao salvar');
      setName(''); setMustHave(''); setDiet(''); setMobility(''); setAvoid('');
      await load(); await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao salvar'); }
    finally { setBusy(false); }
  }

  async function remove(companionId:string) {
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/trips/${tripId}/companions`, {
        method:'DELETE', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({companionId}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Erro ao excluir');
      await load(); await onChanged();
    } catch(e) { setError(e instanceof Error ? e.message : 'Falha ao excluir'); }
    finally { setBusy(false); }
  }

  const mismatch = ownerPace != null && people.some(p =>
    (ownerPace === 'relaxed' && p.pace === 'intense') ||
    (ownerPace === 'intense' && p.pace === 'relaxed')
  );
  const max = Math.max(0,travelerCount-1);
  return (
    <section className="card section">
      <div className="kicker">Etapa 2 · Preferências individuais</div>
      <h3>Quem viaja com você?</h3>
      <p className="muted">{people.length} de {max} acompanhantes cadastrados. Cada pessoa informa um item inegociável.</p>
      {people.map(p => (
        <div className="region" key={p.id}>
          <strong>{p.display_name}</strong>
          <p>Ritmo: {p.pace ? labels[p.pace] : 'não informado'} · Inegociável: {p.must_have}</p>
          {p.diet && <p>Alimentação: {p.diet}</p>}
          {p.mobility && <p>Mobilidade: {p.mobility}</p>}
          {p.avoid_times && <p>Evitar: {p.avoid_times}</p>}
          <button className="btn secondary" type="button" disabled={busy}
            onClick={() => void remove(p.id)}>Remover</button>
        </div>
      ))}
      {mismatch && <p className="note" role="status">
        Atenção: há ritmos opostos (tranquilo e intenso). Conversem antes de aprovar.
      </p>}
      <p className="note">Horários, alimentação e inegociáveis diferentes exigem revisão humana. O sistema não presume automaticamente que são incompatíveis.</p>
      {people.length < max && (
        <form onSubmit={submit}>
          <label className="field">Nome
            <input required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/>
          </label>
          <label className="field">Ritmo
            <select value={pace} onChange={e=>setPace(e.target.value as Pace)}>
              {Object.entries(labels).map(([k,v])=><option value={k} key={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">Alimentação
            <input maxLength={500} value={diet} onChange={e=>setDiet(e.target.value)}/>
          </label>
          <label className="field">Mobilidade
            <input maxLength={1000} value={mobility} onChange={e=>setMobility(e.target.value)}/>
          </label>
          <label className="field">Horários a evitar
            <input maxLength={500} value={avoid} onChange={e=>setAvoid(e.target.value)}/>
          </label>
          <label className="field">Item inegociável
            <input required maxLength={300} value={mustHave}
              onChange={e=>setMustHave(e.target.value)} placeholder="Ex.: nada antes das 9h"/>
          </label>
          <button className="btn" type="submit" disabled={busy || !isOwner}>
            {busy ? 'Salvando…' : 'Adicionar acompanhante'}
          </button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
