'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';
import { CURRENCIES, tripInput, toTripRow } from '@/lib/validation';

const FIELDS = [
  ['destination', 'Destino', 'text'],
  ['origin', 'Origem', 'text'],
  ['start_date', 'Data de ida', 'date'],
  ['end_date', 'Data de volta', 'date'],
  ['travelers', 'Viajantes', 'number'],
  ['budget_total', 'Orçamento total', 'number'],
] as const;

export default function NovaViagem() {
  const router = useRouter();
  const [form, setForm] = useState({
    destination: '',
    origin: '',
    start_date: '',
    end_date: '',
    travelers: 2,
    budget_total: 200,
    currency: 'EUR',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const parsed = tripInput.safeParse(form);
    if (!parsed.success) return setError(parsed.error.issues[0].message);

    setLoading(true);
    const db = supabaseBrowser();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return router.push('/login');

    const { data, error } = await db
      .from('trips')
      .insert({ ...toTripRow(parsed.data), owner_id: user.id })
      .select('id')
      .single();
    if (error) {
      setLoading(false);
      return setError(error.message);
    }

    // A etapa "Criar viagem" está concluída: aprova e abre a seguinte.
    const approval = await db.rpc('approve_stage', { p_trip: data.id, p_stage: 'create_trip' });
    setLoading(false);
    if (approval.error) return setError(approval.error.message);
    router.push(`/viagens/${data.id}/viajantes`);
  }

  return (
    <main className="panel">
      <h1>Criar nova viagem</h1>
      <span className="step">Etapa 1 de 7</span>
      <form onSubmit={submit} className="topspace">
        <div className="grid">
          {FIELDS.map(([key, title, type]) => (
            <label className="field" key={key}>
              {title}
              <input
                required={key !== 'origin'}
                type={type}
                min={type === 'number' ? '0' : undefined}
                value={form[key]}
                onChange={(e) =>
                  setForm((v) => ({
                    ...v,
                    [key]: type === 'number' ? Number(e.target.value) : e.target.value,
                  }))
                }
              />
            </label>
          ))}
        </div>
        <label className="field">
          Moeda
          <select
            value={form.currency}
            onChange={(e) => setForm((v) => ({ ...v, currency: e.target.value }))}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <p className="error" role="alert">
          {error}
        </p>
        <button disabled={loading} className="btn">
          {loading ? 'Salvando...' : 'Salvar e continuar'}
        </button>
      </form>
    </main>
  );
}
