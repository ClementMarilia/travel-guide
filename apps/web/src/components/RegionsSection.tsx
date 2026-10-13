'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';
import { PRICE_STATUS_LABEL, money, type PriceStatus } from '@/lib/budget';

type Region = {
  id: string;
  name: string;
  summary: string | null;
  pros: string[];
  cons: string[];
  access: string | null;
  walkability: string | null;
  parking: string | null;
  fit: string | null;
  price_min: number | null;
  price_max: number | null;
  price_status: PriceStatus;
  source: string;
  chosen: boolean;
};

export default function RegionsSection({
  tripId,
  destination,
  currency,
  approved,
  isOwner,
  onChanged,
}: {
  tripId: string;
  destination: string;
  currency: string;
  approved: boolean;
  isOwner: boolean;
  onChanged: () => Promise<void>;
}) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from('trip_regions')
      .select('*')
      .eq('trip_id', tripId)
      .order('generated_at', { ascending: true });
    setRegions((data ?? []) as Region[]);
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setError('');
    const problem = await fn();
    if (problem) setError(problem);
    await load();
    await onChanged();
    setBusy(false);
  }

  const suggest = () =>
    run(async () => {
      const res = await fetch(`/api/trips/${tripId}/regions`, { method: 'POST' });
      const data = await res.json();
      return res.ok ? null : (data.error ?? 'Erro ao sugerir regiões');
    });

  const choose = (regionId: string) =>
    run(async () => {
      const { error } = await supabaseBrowser().rpc('choose_region', { p_trip: tripId, p_region: regionId });
      return error ? error.message : null;
    });

  const approve = () =>
    run(async () => {
      const { error } = await supabaseBrowser().rpc('approve_stage', { p_trip: tripId, p_stage: 'base' });
      return error ? error.message : null;
    });

  const chosen = regions.find((r) => r.chosen);

  return (
    <section className="card section">
      <div className="kicker">Etapa 3 · Escolher a base</div>
      <p style={{ margin: '6px 0 12px' }}>
        A IA compara até três regiões de {destination}. Os preços são aproximações e{' '}
        <strong>não foram verificados</strong>.
      </p>

      {regions.map((r) => (
        <article key={r.id} className={`region${r.chosen ? ' chosen' : ''}`}>
          <h3>
            {r.name} {r.chosen && <span className="chip">✓ Base escolhida</span>}
          </h3>
          {r.summary && <p>{r.summary}</p>}
          {!!r.pros.length && (
            <ul className="pros">
              {r.pros.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {!!r.cons.length && (
            <ul className="cons">
              {r.cons.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          <dl className="facts">
            {r.access && (
              <>
                <dt>Acesso</dt>
                <dd>{r.access}</dd>
              </>
            )}
            {r.walkability && (
              <>
                <dt>A pé</dt>
                <dd>{r.walkability}</dd>
              </>
            )}
            {r.parking && (
              <>
                <dt>Estacionamento</dt>
                <dd>{r.parking}</dd>
              </>
            )}
            {r.fit && (
              <>
                <dt>Combina com você</dt>
                <dd>{r.fit}</dd>
              </>
            )}
            <dt>Hospedagem</dt>
            <dd>
              {r.price_min != null && r.price_max != null
                ? `${money(r.price_min, currency)} a ${money(r.price_max, currency)} por noite, por quarto`
                : 'Preço indisponível'}{' '}
              <span className="chip">{PRICE_STATUS_LABEL[r.price_status]}</span>
              <div className="muted">{r.source}</div>
            </dd>
          </dl>
          <p style={{ margin: 0 }}>
            <a
              className="muted"
              target="_blank"
              rel="noopener noreferrer"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`hospedagem ${r.name} ${destination}`)}`}
            >
              Ver hospedagens no mapa ↗
            </a>
          </p>
          {!r.chosen && (
            <button className="btn secondary" disabled={busy} onClick={() => choose(r.id)}>
              Escolher esta base
            </button>
          )}
        </article>
      ))}

      <button className="btn" disabled={busy} onClick={suggest}>
        {busy ? 'Aguarde…' : regions.length ? 'Gerar novas sugestões' : 'Sugerir regiões'}
      </button>
      {regions.length > 0 && <p className="note">Gerar novas sugestões mantém a base já escolhida.</p>}

      {chosen && !approved && (
        <>
          {isOwner ? (
            <button className="btn" style={{ marginTop: 10 }} disabled={busy} onClick={approve}>
              Aprovar base: {chosen.name}
            </button>
          ) : (
            <p className="note">Somente o proprietário da viagem pode aprovar a base.</p>
          )}
        </>
      )}
      <p className="error" role="alert">
        {error}
      </p>
    </section>
  );
}
