'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';
import { parseMustHaves, preferenceInput, type PreferenceInput } from '@/lib/validation';
import type { StageStatus } from '@/lib/stages';

type Initial = Partial<Omit<PreferenceInput, 'must_haves'>> & { must_haves?: string[] | null };

const TEXT_FIELDS = [
  ['diet', 'Alimentação'],
  ['mobility', 'Mobilidade e acessibilidade'],
  ['avoid_times', 'Horários a evitar'],
  ['must_haves', 'Itens inegociáveis (um por linha)'],
] as const;

export default function PreferenceForm({
  tripId,
  label,
  stageStatus,
  initial,
}: {
  tripId: string;
  label: string;
  stageStatus: StageStatus;
  initial?: Initial | null;
}) {
  const router = useRouter();
  const [v, setV] = useState<PreferenceInput>({
    pace: initial?.pace ?? 'balanced',
    main_transport: initial?.main_transport ?? 'car',
    diet: initial?.diet ?? '',
    mobility: initial?.mobility ?? '',
    avoid_times: initial?.avoid_times ?? '',
    must_haves: (initial?.must_haves ?? []).join('\n'),
  });
  const [notice, setNotice] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice('');
    const parsed = preferenceInput.safeParse(v);
    if (!parsed.success) {
      setNotice(parsed.error.issues[0].message);
      return setBusy(false);
    }

    const db = supabaseBrowser();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) {
      setNotice('Faça login novamente.');
      return setBusy(false);
    }

    const { must_haves, ...rest } = parsed.data;
    const { error } = await db
      .from('traveler_preferences')
      .upsert(
        { trip_id: tripId, user_id: user.id, label, ...rest, must_haves: parseMustHaves(must_haves) },
        { onConflict: 'trip_id,user_id' },
      );
    if (error) {
      setNotice(error.message);
      return setBusy(false);
    }

    // Mudar algo já aprovado reabre a etapa e marca as seguintes para revisão.
    if (stageStatus === 'approved') {
      await db.rpc('reopen_stage', { p_trip: tripId, p_stage: 'travelers' });
      router.refresh();
    }
    setNotice('Preferências salvas. Revise e aprove antes de avançar.');
    setBusy(false);
  }

  async function summarize() {
    setBusy(true);
    setNotice('');
    try {
      const res = await fetch('/api/ai/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tripId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro de IA');
      setSummary(data.summary);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Falha');
    }
    setBusy(false);
  }

  return (
    <div className="panel">
      <form onSubmit={save}>
        <div className="grid">
          <label className="field">
            Ritmo
            <select
              value={v.pace}
              onChange={(e) => setV({ ...v, pace: e.target.value as PreferenceInput['pace'] })}
            >
              <option value="relaxed">Tranquilo</option>
              <option value="balanced">Equilibrado</option>
              <option value="intense">Intenso</option>
            </select>
          </label>
          <label className="field">
            Transporte
            <select
              value={v.main_transport}
              onChange={(e) =>
                setV({ ...v, main_transport: e.target.value as PreferenceInput['main_transport'] })
              }
            >
              <option value="car">Carro</option>
              <option value="public">Público</option>
              <option value="mixed">Misto</option>
            </select>
          </label>
        </div>
        {TEXT_FIELDS.map(([key, title]) => (
          <label className="field" key={key}>
            {title}
            <textarea value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} />
          </label>
        ))}
        <button className="btn" disabled={busy}>
          Salvar preferências
        </button>
      </form>
      <button style={{ marginTop: 10 }} className="btn secondary" onClick={summarize} disabled={busy}>
        Gerar resumo com IA
      </button>
      <p aria-live="polite">{notice}</p>
      {summary && (
        <section className="panel">
          <h3>Resumo para revisão</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{summary}</p>
          <strong>Este resumo não aprova nem avança etapas automaticamente.</strong>
        </section>
      )}
    </div>
  );
}
