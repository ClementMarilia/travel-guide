import type { StageKey, StageRow } from './stages';

export type ChecklistTrip = {
  destination: string | null;
  origin_city: string | null;
  travel_party: string | null;
  traveler_count: number;
  start_date: string | null;
  end_date: string | null;
  interests: string[];
};

export type ChecklistItem = {
  key: 'destination' | 'origin' | 'party' | 'dates' | 'interests';
  label: string;
  hint: string;
  done: boolean;
  value: string | null;
};

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function checklistItems(t: ChecklistTrip): ChecklistItem[] {
  const people = t.traveler_count === 1 ? '1 pessoa' : `${t.traveler_count} pessoas`;
  return [
    {
      key: 'destination',
      label: 'Para onde você vai?',
      hint: 'Se não souber, eu te inspiro.',
      done: !!t.destination,
      value: t.destination,
    },
    {
      key: 'origin',
      label: 'De onde você sai?',
      hint: 'Vou perguntar a cidade de partida.',
      done: !!t.origin_city,
      value: t.origin_city,
    },
    {
      key: 'party',
      label: 'Quem vem junto?',
      hint: 'Vou perguntar com quem você viaja.',
      done: !!t.travel_party,
      value: t.travel_party ? `${t.travel_party} · ${people}` : null,
    },
    {
      key: 'dates',
      label: 'Quando você iria?',
      hint: 'Vou perguntar as datas.',
      done: !!t.start_date && !!t.end_date,
      value: t.start_date && t.end_date ? `${formatDate(t.start_date)} → ${formatDate(t.end_date)}` : null,
    },
    {
      key: 'interests',
      label: 'O que você procura?',
      hint: 'Vou perguntar o que faria essa viagem ser sua.',
      done: t.interests.length > 0,
      value: t.interests.length ? t.interests.join(', ') : null,
    },
  ];
}

export function capturedCount(t: ChecklistTrip): number {
  return checklistItems(t).filter((i) => i.done).length;
}

export function isComplete(t: ChecklistTrip): boolean {
  return capturedCount(t) === 5;
}

export type NextAction =
  | { kind: 'collect' }
  | { kind: 'confirm_trip' }
  | { kind: 'approve_travelers' }
  | { kind: 'coming_soon'; stage: StageKey }
  | { kind: 'done' };

/** O que o painel oferece agora. Nenhuma etapa avança sem aprovação explícita. */
export function nextAction(stages: StageRow[], complete: boolean, hasPrefs: boolean): NextAction {
  const status = (k: StageKey) => stages.find((s) => s.stage === k)?.status ?? 'not_started';
  if (status('create_trip') !== 'approved') return complete ? { kind: 'confirm_trip' } : { kind: 'collect' };
  if (status('travelers') !== 'approved')
    return hasPrefs ? { kind: 'approve_travelers' } : { kind: 'collect' };
  const order: StageKey[] = ['base', 'viability', 'itinerary', 'review', 'prepare'];
  const pending = order.find((k) => status(k) !== 'approved');
  return pending ? { kind: 'coming_soon', stage: pending } : { kind: 'done' };
}
