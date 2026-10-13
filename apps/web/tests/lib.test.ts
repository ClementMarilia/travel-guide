import { describe, expect, it } from 'vitest';
import {
  mergeList,
  parseUpdates,
  splitUpdates,
  type PrefFields,
  type TripFields,
} from '../src/lib/chat-updates';
import { capturedCount, checklistItems, formatDate, isComplete, nextAction } from '../src/lib/checklist';
import { currentStage, progressPercent, type StageRow } from '../src/lib/stages';
import { rateLimit } from '../src/lib/rate-limit';
import { filterModels, pickModel, sortModels } from '../src/lib/models';

const emptyTrip: TripFields = {
  destination: null,
  origin_city: null,
  travel_party: null,
  traveler_count: 1,
  start_date: null,
  end_date: null,
  interests: [],
  total_budget: null,
  currency: 'EUR',
};
const fullTrip: TripFields = {
  ...emptyTrip,
  destination: 'Ljubljana',
  origin_city: 'Milão',
  travel_party: 'casal',
  traveler_count: 2,
  start_date: '2026-11-21',
  end_date: '2026-11-22',
  interests: ['gastronomia'],
};
const noPrefs: PrefFields | null = null;

describe('parseUpdates', () => {
  it('mantém campos válidos e descarta os inválidos sem derrubar os demais', () => {
    const u = parseUpdates({
      destination: 'Ljubljana',
      start_date: 'amanhã',
      pace: 'fast',
      traveler_count: 2,
      currency: null,
    });
    expect(u).toEqual({ destination: 'Ljubljana', traveler_count: 2 });
  });

  it('ignora entrada que não é objeto e campos desconhecidos', () => {
    expect(parseUpdates(null)).toEqual({});
    expect(parseUpdates({ is_admin: true })).toEqual({});
  });
});

describe('mergeList', () => {
  it('acrescenta sem repetir e respeita o limite', () => {
    expect(mergeList(['Museus'], ['museus', 'trilhas'], 5)).toEqual(['Museus', 'trilhas']);
    expect(mergeList(['a', 'b'], ['c'], 2)).toEqual(['a', 'b']);
  });
});

describe('splitUpdates', () => {
  it('separa viagem e preferências e gera o título', () => {
    const { tripPatch, prefPatch } = splitUpdates(
      { destination: 'Ljubljana', pace: 'relaxed', must_haves: ['comida típica'] },
      emptyTrip,
      noPrefs,
    );
    expect(tripPatch).toEqual({ destination: 'Ljubljana', title: 'Viagem a Ljubljana' });
    expect(prefPatch).toEqual({ pace: 'relaxed', must_haves: ['comida típica'] });
  });

  it('ignora valores iguais aos atuais (não reabre etapa à toa)', () => {
    const { tripPatch } = splitUpdates(
      { destination: 'Ljubljana', interests: ['Gastronomia'] },
      fullTrip,
      noPrefs,
    );
    expect(tripPatch).toEqual({});
  });

  it('descarta datas em que a volta é anterior à ida', () => {
    const { tripPatch } = splitUpdates(
      { start_date: '2026-12-10', end_date: '2026-12-01' },
      emptyTrip,
      noPrefs,
    );
    expect(tripPatch).toEqual({});
    const merged = splitUpdates({ end_date: '2026-11-20' }, fullTrip, noPrefs);
    expect(merged.tripPatch).toEqual({});
  });

  it('acrescenta interesses aos já salvos', () => {
    const { tripPatch } = splitUpdates({ interests: ['trilhas'] }, fullTrip, noPrefs);
    expect(tripPatch).toEqual({ interests: ['gastronomia', 'trilhas'] });
  });
});

describe('checklist', () => {
  it('conta itens e só completa com os 5', () => {
    expect(capturedCount(emptyTrip)).toBe(0);
    expect(capturedCount({ ...emptyTrip, destination: 'Roma' })).toBe(1);
    expect(isComplete(fullTrip)).toBe(true);
    expect(isComplete({ ...fullTrip, end_date: null })).toBe(false);
  });

  it('formata datas e o grupo de viajantes', () => {
    expect(formatDate('2026-11-21')).toBe('21/11/2026');
    const items = checklistItems(fullTrip);
    expect(items.find((i) => i.key === 'party')?.value).toBe('casal · 2 pessoas');
    expect(items.find((i) => i.key === 'dates')?.value).toBe('21/11/2026 → 22/11/2026');
  });
});

describe('nextAction', () => {
  const rows = (...s: [string, string][]): StageRow[] =>
    s.map(([stage, status]) => ({ stage, status }) as StageRow);

  it('exige a lista completa antes de confirmar a viagem', () => {
    expect(nextAction(rows(['create_trip', 'in_progress']), false, false).kind).toBe('collect');
    expect(nextAction(rows(['create_trip', 'in_progress']), true, false).kind).toBe('confirm_trip');
  });

  it('só oferece aprovar preferências depois da viagem aprovada e com preferências salvas', () => {
    const approved = rows(['create_trip', 'approved'], ['travelers', 'in_progress']);
    expect(nextAction(approved, true, false).kind).toBe('collect');
    expect(nextAction(approved, true, true).kind).toBe('approve_travelers');
  });

  it('volta a pedir confirmação quando uma etapa fica em revisão', () => {
    expect(nextAction(rows(['create_trip', 'needs_review']), true, true).kind).toBe('confirm_trip');
  });

  it('indica a próxima etapa ainda não construída', () => {
    const done = rows(['create_trip', 'approved'], ['travelers', 'approved']);
    expect(nextAction(done, true, true)).toEqual({ kind: 'coming_soon', stage: 'base' });
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
});

describe('rateLimit', () => {
  it('bloqueia acima do limite e libera após a janela', () => {
    expect(rateLimit('k', 2, 1000, 0)).toBe(true);
    expect(rateLimit('k', 2, 1000, 10)).toBe(true);
    expect(rateLimit('k', 2, 1000, 20)).toBe(false);
    expect(rateLimit('k', 2, 1000, 1500)).toBe(true);
  });
});

describe('models', () => {
  const raw = {
    models: [
      {
        name: 'models/gemini-3.8-flash',
        displayName: 'Gemini 3.8 Flash',
        supportedGenerationMethods: ['generateContent'],
      },
      {
        name: 'models/gemini-3.0-pro',
        displayName: 'Gemini 3.0 Pro',
        supportedGenerationMethods: ['generateContent'],
      },
      {
        name: 'models/gemini-embedding-001',
        displayName: 'Embedding',
        supportedGenerationMethods: ['embedContent'],
      },
      {
        name: 'models/gemini-3.8-flash-image',
        displayName: 'Image',
        supportedGenerationMethods: ['generateContent'],
      },
      { name: 'models/text-bison', displayName: 'Bison', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-bad id', displayName: 'Bad', supportedGenerationMethods: ['generateContent'] },
    ],
  };

  it('mantém só modelos Gemini de chat', () => {
    expect(filterModels(raw).map((m) => m.id)).toEqual(['gemini-3.8-flash', 'gemini-3.0-pro']);
    expect(filterModels(null)).toEqual([]);
  });

  it('põe o recomendado primeiro e ordena os demais do mais novo ao mais antigo', () => {
    const list = [
      { id: 'gemini-2.5-flash', label: 'a' },
      { id: 'gemini-3.8-flash', label: 'b' },
      { id: 'gemini-3.0-pro', label: 'c' },
    ];
    expect(sortModels(list, 'gemini-3.0-pro').map((m) => m.id)).toEqual([
      'gemini-3.0-pro',
      'gemini-3.8-flash',
      'gemini-2.5-flash',
    ]);
  });

  it('só usa a preferência se o modelo ainda existir', () => {
    const list = [{ id: 'gemini-3.8-flash', label: 'x' }];
    expect(pickModel('gemini-3.8-flash', list, 'fallback')).toBe('gemini-3.8-flash');
    expect(pickModel('gemini-removido', list, 'fallback')).toBe('fallback');
    expect(pickModel(null, list, 'fallback')).toBe('fallback');
  });
});
