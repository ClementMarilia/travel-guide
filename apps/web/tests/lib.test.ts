import { describe, expect, it } from 'vitest';
import { parseMustHaves, preferenceInput, toTripRow, tripInput } from '../src/lib/validation';
import { currentStage, progressPercent, type StageRow } from '../src/lib/stages';
import { rateLimit } from '../src/lib/rate-limit';

const trip = {
  destination: 'Ljubljana',
  origin: '',
  start_date: '2026-11-21',
  end_date: '2026-11-22',
  travelers: 2,
  budget_total: 200,
  currency: 'EUR',
};

describe('tripInput', () => {
  it('aceita o cenário de teste da Eslovênia e mapeia para a tabela', () => {
    const row = toTripRow(tripInput.parse(trip));
    expect(row).toMatchObject({
      title: 'Viagem a Ljubljana',
      origin_city: null,
      traveler_count: 2,
      total_budget: 200,
    });
  });

  it('rejeita volta antes da ida', () => {
    expect(tripInput.safeParse({ ...trip, end_date: '2026-11-20' }).success).toBe(false);
  });

  it('rejeita orçamento negativo e moeda desconhecida', () => {
    expect(tripInput.safeParse({ ...trip, budget_total: -1 }).success).toBe(false);
    expect(tripInput.safeParse({ ...trip, currency: 'XYZ' }).success).toBe(false);
  });
});

describe('preferenceInput', () => {
  it('rejeita ritmo inválido', () => {
    expect(
      preferenceInput.safeParse({
        pace: 'fast',
        main_transport: 'car',
        diet: '',
        mobility: '',
        avoid_times: '',
        must_haves: '',
      }).success,
    ).toBe(false);
  });

  it('separa exigências por linha ignorando vazias', () => {
    expect(parseMustHaves('comida típica\n\n  caminhadas curtas \n')).toEqual([
      'comida típica',
      'caminhadas curtas',
    ]);
  });
});

describe('stages', () => {
  const rows: StageRow[] = [
    { stage: 'create_trip', status: 'approved' },
    { stage: 'travelers', status: 'in_progress' },
    { stage: 'base', status: 'not_started' },
  ];

  it('calcula progresso e etapa atual', () => {
    expect(progressPercent(rows)).toBe(14);
    expect(currentStage(rows)).toBe('travelers');
  });

  it('trata revisão necessária como pendente', () => {
    expect(currentStage([{ stage: 'create_trip', status: 'needs_review' }])).toBe('create_trip');
  });
});

describe('rateLimit', () => {
  it('bloqueia acima do limite e libera após a janela', () => {
    expect(rateLimit('k', 2, 1000, 0)).toBe(true);
    expect(rateLimit('k', 2, 1000, 10)).toBe(true);
    expect(rateLimit('k', 2, 1000, 20)).toBe(false);
    expect(rateLimit('k', 2, 1000, 1500)).toBe(true);
  });
});
