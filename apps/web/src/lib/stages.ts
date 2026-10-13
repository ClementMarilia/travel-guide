export const STAGES = [
  { key: 'create_trip', label: 'Criar viagem' },
  { key: 'travelers', label: 'Conhecer os viajantes' },
  { key: 'base', label: 'Escolher a base' },
  { key: 'viability', label: 'Validar a viabilidade' },
  { key: 'itinerary', label: 'Construir o roteiro' },
  { key: 'review', label: 'Revisar e aprovar' },
  { key: 'prepare', label: 'Preparar e utilizar' },
] as const;

export type StageKey = (typeof STAGES)[number]['key'];
export type StageStatus = 'not_started' | 'in_progress' | 'approved' | 'needs_review';

export const STATUS_LABEL: Record<StageStatus, string> = {
  not_started: 'Não iniciada',
  in_progress: 'Em elaboração',
  approved: 'Aprovada',
  needs_review: 'Revisão necessária',
};

export type StageRow = { stage: StageKey; status: StageStatus };

export function stageNumber(key: StageKey): number {
  return STAGES.findIndex((s) => s.key === key) + 1;
}

export function approvedCount(rows: StageRow[]): number {
  return rows.filter((r) => r.status === 'approved').length;
}

export function progressPercent(rows: StageRow[]): number {
  return Math.round((approvedCount(rows) / STAGES.length) * 100);
}

/** Primeira etapa que ainda precisa de ação do usuário. */
export function currentStage(rows: StageRow[]): StageKey | null {
  for (const { key } of STAGES) {
    const row = rows.find((r) => r.stage === key);
    if (!row || row.status !== 'approved') return key;
  }
  return null;
}
