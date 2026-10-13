'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { supabaseBrowser } from '@/lib/supabase';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  PRICE_STATUS_LABEL,
  evaluate,
  money,
  nightsBetween,
  suggestions,
  type Category,
  type Line,
  type PriceStatus,
} from '@/lib/budget';

type Item = {
  category: Category;
  planned: number;
  est_min: number | null;
  est_max: number | null;
  status: PriceStatus;
  source: string | null;
  region_id: string | null;
};
type Region = {
  id: string;
  name: string;
  price_min: number | null;
  price_max: number | null;
  chosen: boolean;
};

const VERDICT_TEXT = {
  viable: 'Cabe no orçamento, mesmo na estimativa máxima.',
  tight: 'Cabe na estimativa mínima, mas fica apertado se os custos forem os maiores.',
  deficit: 'Não cabe no orçamento.',
  unknown: 'Ainda faltam estimativas para concluir.',
} as const;

const planned = z.number().nonnegative().max(1e9);

export default function BudgetSection({
  tripId,
  currency,
  totalBudget,
  startDate,
  endDate,
  travelers,
  approved,
  isOwner,
  onChanged,
}: {
  tripId: string;
  currency: string;
  totalBudget: number | null;
  startDate: string | null;
  endDate: string | null;
  travelers: number;
  approved: boolean;
  isOwner: boolean;
  onChanged: () => Promise<void>;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [assumptions, setAssumptions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const db = supabaseBrowser();
    const [i, r] = await Promise.all([
      db.from('budget_items').select('*').eq('trip_id', tripId),
      db.from('trip_regions').select('id,name,price_min,price_max,chosen').eq('trip_id', tripId),
    ]);
    setItems(((i.data ?? []) as Item[]).map((x) => ({ ...x, planned: Number(x.planned) })));
    setRegions((r.data ?? []) as Region[]);
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  const nights = startDate && endDate ? nightsBetween(startDate, endDate) : 1;
  const chosen = regions.find((r) => r.chosen);
  const byCat = new Map(items.map((i) => [i.category, i]));
  const hasItems = items.length === CATEGORIES.length;
  const stale = hasItems && !!chosen && byCat.get('lodging')?.region_id !== chosen.id;

  const lines: Line[] = CATEGORIES.map((c) => {
    const i = byCat.get(c);
    return {
      category: c,
      planned: i?.planned ?? 0,
      est:
        i && i.est_min != null && i.est_max != null
          ? { min: Number(i.est_min), max: Number(i.est_max) }
          : null,
      status: i?.status ?? 'unavailable',
    };
  });
  const ev = totalBudget != null && hasItems ? evaluate(totalBudget, lines) : null;
  const tips = ev ? suggestions(ev, currency, nights, travelers, regions) : [];

  async function estimate() {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/trips/${tripId}/budget`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Erro ao estimar custos');
    else setAssumptions(data.assumptions ?? '');
    await load();
    await onChanged();
    setBusy(false);
  }

  async function savePlanned(category: Category, raw: string) {
    const parsed = planned.safeParse(Number(raw.replace(',', '.')));
    if (!parsed.success || parsed.data === byCat.get(category)?.planned) return;
    setError('');
    const db = supabaseBrowser();
    const { error } = await db
      .from('budget_items')
      .update({ planned: parsed.data })
      .eq('trip_id', tripId)
      .eq('category', category);
    if (error) return setError(error.message);
    if (approved) await db.rpc('reopen_stage', { p_trip: tripId, p_stage: 'viability' });
    await load();
    await onChanged();
  }

  async function approve() {
    setBusy(true);
    setError('');
    const { error } = await supabaseBrowser().rpc('approve_stage', { p_trip: tripId, p_stage: 'viability' });
    if (error) setError(error.message);
    await onChanged();
    setBusy(false);
  }

  const blocker = !ev
    ? 'Estime os custos primeiro.'
    : stale
      ? 'A base mudou: atualize as estimativas.'
      : ev.overAllocated > 0
        ? `O valor planejado passa do orçamento em ${money(ev.overAllocated, currency)}.`
        : ev.verdict === 'deficit'
          ? 'Ajuste o orçamento ou a base antes de aprovar.'
          : ev.verdict === 'unknown'
            ? 'Faltam estimativas para concluir.'
            : '';

  return (
    <section className="card section">
      <div className="kicker">Etapa 4 · Validar a viabilidade</div>
      {totalBudget == null ? (
        <p>
          Conte o <strong>orçamento total</strong> no chat para validar se a viagem cabe.
        </p>
      ) : (
        <p style={{ margin: '6px 0 12px' }}>
          Orçamento total: <strong>{money(totalBudget, currency)}</strong> · {nights}{' '}
          {nights === 1 ? 'noite' : 'noites'} · {travelers} {travelers === 1 ? 'pessoa' : 'pessoas'}. Faixas
          estimadas, não cotações.
        </p>
      )}

      {totalBudget != null && (
        <button className="btn secondary" disabled={busy} onClick={estimate}>
          {busy ? 'Aguarde…' : hasItems ? 'Atualizar estimativas' : 'Estimar custos'}
        </button>
      )}
      {stale && <p className="error">A base escolhida mudou desde a última estimativa.</p>}

      {hasItems && (
        <table className="budget">
          <thead>
            <tr>
              <th>Categoria</th>
              <th>Planejado</th>
              <th>Estimativa</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const row = byCat.get(l.category)!;
              const lv = ev?.lines.find((x) => x.category === l.category);
              return (
                <tr key={l.category}>
                  <td>{CATEGORY_LABEL[l.category]}</td>
                  <td>
                    <input
                      key={row.planned}
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={row.planned}
                      aria-label={`Planejado: ${CATEGORY_LABEL[l.category]}`}
                      onBlur={(e) => savePlanned(l.category, e.target.value)}
                    />
                  </td>
                  <td title={row.source ?? undefined}>
                    {l.est ? `${money(l.est.min, currency)} a ${money(l.est.max, currency)}` : '—'}
                    <div className="muted">
                      {PRICE_STATUS_LABEL[row.status]}
                      {lv?.level === 'short' &&
                        l.category !== 'buffer' &&
                        ` · faltam ${money(lv.gap, currency)}`}
                      {lv?.level === 'short' &&
                        l.category === 'buffer' &&
                        ` · reserva abaixo de 5% (faltam ${money(lv.gap, currency)})`}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {ev && (
        <div className={`verdict ${ev.verdict}`} role="status">
          <strong>{VERDICT_TEXT[ev.verdict]}</strong>
          <div>
            Custo mínimo estimado: {money(ev.needMin, currency)} · máximo: {money(ev.needMax, currency)} ·
            disponível após a reserva de 5%: {money(ev.usable, currency)}
          </div>
          {ev.deficit > 0 && <div>Déficit: {money(ev.deficit, currency)}</div>}
          {ev.missing.length > 0 && (
            <div>Sem estimativa: {ev.missing.map((c) => CATEGORY_LABEL[c]).join(', ')}.</div>
          )}
        </div>
      )}
      {tips.length > 0 && (
        <ul className="tips">
          {tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {assumptions && <p className="note">Suposições da IA: {assumptions}</p>}

      {hasItems && !approved && (
        <>
          <button
            className="btn"
            style={{ marginTop: 10 }}
            disabled={busy || !isOwner || !!blocker}
            onClick={approve}
          >
            Aprovar viabilidade
          </button>
          {!isOwner && <p className="note">Somente o proprietário da viagem pode aprovar.</p>}
          {isOwner && blocker && <p className="note">{blocker}</p>}
        </>
      )}
      <p className="error" role="alert">
        {error}
      </p>
    </section>
  );
}
