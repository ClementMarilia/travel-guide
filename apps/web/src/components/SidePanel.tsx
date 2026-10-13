'use client';

import { useState } from 'react';
import { checklistItems, capturedCount, isComplete, nextAction } from '@/lib/checklist';
import { STAGES, STATUS_LABEL, type StageKey } from '@/lib/stages';
import type { TripState } from '@/lib/trip-state';
import { supabaseBrowser } from '@/lib/supabase';
import RegionsSection from './RegionsSection';
import BudgetSection from './BudgetSection';

const PACE = { relaxed: 'Tranquilo', balanced: 'Equilibrado', intense: 'Intenso' } as const;
const TRANSPORT = { car: 'Carro', public: 'Público', mixed: 'Misto' } as const;

function Ring({ value, total }: { value: number; total: number }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className="ring"
      width="60"
      height="60"
      viewBox="0 0 60 60"
      role="img"
      aria-label={`${value} de ${total}`}
    >
      <circle cx="30" cy="30" r={r} fill="none" stroke="#ffffff90" strokeWidth="5" />
      <circle
        cx="30"
        cy="30"
        r={r}
        fill="none"
        stroke="#6d4aff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value / total)}
        transform="rotate(-90 30 30)"
      />
      <text x="30" y="35" textAnchor="middle" fontSize="16" fontWeight="700" fill="#1c1730">
        {value}/{total}
      </text>
    </svg>
  );
}

export default function SidePanel({
  tripId,
  state,
  isOwner,
  onChanged,
}: {
  tripId: string;
  state: TripState;
  isOwner: boolean;
  onChanged: () => Promise<void>;
}) {
  const { trip, prefs, stages } = state;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const items = checklistItems(trip);
  const count = capturedCount(trip);
  const hasPrefs = !!prefs && !!(prefs.pace || prefs.main_transport || prefs.diet || prefs.must_haves.length);
  const action = nextAction(stages, isComplete(trip), hasPrefs);

  async function approve(stage: StageKey) {
    setBusy(true);
    setError('');
    try {
      const { error } = await supabaseBrowser().rpc('approve_stage', { p_trip: tripId, p_stage: stage });
      if (error) setError(error.message);
      else await onChanged();
    } catch {
      setError('Falha de conexão. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="side">
      <div className="side-inner">
        <div className="progress">
          <Ring value={count} total={items.length} />
          <div>
            <div className="kicker">Lista de verificação da viagem</div>
            <h2>{count === items.length ? 'Tudo capturado!' : 'Sua viagem está tomando forma'}</h2>
          </div>
        </div>

        <ul className="checklist">
          {items.map((i) => (
            <li key={i.key}>
              <span className={`dot${i.done ? ' done' : ''}`}>{i.done ? '✓' : ''}</span>
              <div>
                <div className="item-label">{i.label}</div>
                {i.done ? <div className="item-value">{i.value}</div> : <div className="muted">{i.hint}</div>}
              </div>
            </li>
          ))}
        </ul>

        {prefs && (
          <div>
            <div className="kicker">Preferências</div>
            <div className="chips">
              {prefs.pace && <span className="chip">Ritmo: {PACE[prefs.pace as keyof typeof PACE]}</span>}
              {prefs.main_transport && (
                <span className="chip">
                  Transporte: {TRANSPORT[prefs.main_transport as keyof typeof TRANSPORT]}
                </span>
              )}
              {prefs.diet && <span className="chip">Alimentação: {prefs.diet}</span>}
              {prefs.mobility && <span className="chip">Mobilidade: {prefs.mobility}</span>}
              {prefs.avoid_times && <span className="chip">Evitar: {prefs.avoid_times}</span>}
              {prefs.must_haves.map((m) => (
                <span className="chip" key={m}>
                  ★ {m}
                </span>
              ))}
            </div>
          </div>
        )}

        {action.kind === 'base' && trip.destination && (
          <RegionsSection
            tripId={tripId}
            destination={trip.destination}
            currency={trip.currency}
            approved={false}
            isOwner={isOwner}
            onChanged={onChanged}
          />
        )}
        {action.kind === 'viability' && (
          <BudgetSection
            tripId={tripId}
            currency={trip.currency}
            totalBudget={trip.total_budget}
            startDate={trip.start_date}
            endDate={trip.end_date}
            travelers={trip.traveler_count}
            approved={false}
            isOwner={isOwner}
            onChanged={onChanged}
          />
        )}

        <div className="card">
          {action.kind === 'collect' && (
            <>
              <button className="btn" disabled>
                Confirmar e continuar
              </button>
              <p>Continue conversando com a assistente. O botão libera quando a lista estiver completa.</p>
            </>
          )}
          {action.kind === 'confirm_trip' && (
            <>
              <button className="btn" disabled={busy} onClick={() => approve('create_trip')}>
                Confirmar dados da viagem
              </button>
              <p>Revise a lista acima. Você pode pedir mudanças no chat antes de confirmar.</p>
            </>
          )}
          {action.kind === 'approve_travelers' && (
            <>
              <button className="btn" disabled={busy} onClick={() => approve('travelers')}>
                Aprovar preferências
              </button>
              <p>Confira as preferências acima. Ajuste pelo chat se quiser.</p>
            </>
          )}
          {(action.kind === 'base' || action.kind === 'viability') && (
            <p style={{ margin: 0 }}>
              Etapa atual:{' '}
              <strong>{action.kind === 'base' ? 'Escolher a base' : 'Validar a viabilidade'}</strong>.
            </p>
          )}
          {action.kind === 'coming_soon' && (
            <p style={{ margin: 0 }}>
              Próxima etapa: <strong>{STAGES.find((s) => s.key === action.stage)?.label}</strong> (em breve).
            </p>
          )}
          {action.kind === 'done' && <p style={{ margin: 0 }}>Todas as etapas aprovadas.</p>}
          {action.kind === 'collect' &&
            stages.find((s) => s.stage === 'create_trip')?.status === 'approved' && (
              <p>Falta contar suas preferências (ritmo, transporte, alimentação...).</p>
            )}
          <p className="error" role="alert">
            {error}
          </p>
        </div>

        <div>
          <div className="kicker">Etapas</div>
          <ul className="stages">
            {STAGES.map((s) => {
              const st = stages.find((r) => r.stage === s.key)?.status ?? 'not_started';
              return (
                <li key={s.key}>
                  <span>{s.label}</span>
                  <span className={st === 'needs_review' ? 'error' : 'muted'}>{STATUS_LABEL[st]}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </aside>
  );
}
