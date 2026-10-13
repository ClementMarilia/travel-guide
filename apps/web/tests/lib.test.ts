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
import {
  BUFFER_SHARE,
  defaultAllocation,
  evaluate,
  lodgingEstimate,
  nightsBetween,
  roomsFor,
  suggestions,
  type Line,
} from '../src/lib/budget';
import { parseRegions } from '../src/lib/regions';
import { parseEstimate } from '../src/lib/budget-ai';

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

  it('segue para base, viabilidade e só depois para etapas ainda não construídas', () => {
    const two = rows(['create_trip', 'approved'], ['travelers', 'approved']);
    expect(nextAction(two, true, true)).toEqual({ kind: 'base' });
    const three = [...two, ...rows(['base', 'approved'])];
    expect(nextAction(three, true, true)).toEqual({ kind: 'viability' });
    const four = [...three, ...rows(['viability', 'approved'])];
    expect(nextAction(four, true, true)).toEqual({ kind: 'coming_soon', stage: 'itinerary' });
  });

  it('volta à base quando ela entra em revisão', () => {
    const s = rows(['create_trip', 'approved'], ['travelers', 'approved'], ['base', 'needs_review']);
    expect(nextAction(s, true, true)).toEqual({ kind: 'base' });
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

describe('orçamento', () => {
  const line = (category: Line['category'], planned: number, est: Line['est']): Line => ({
    category,
    planned,
    est,
    status: 'estimated',
  });
  const full = (est: Record<string, [number, number] | null>, planned = 0): Line[] =>
    (['lodging', 'food', 'transport', 'activities', 'buffer'] as const).map((c) =>
      line(c, planned, est[c] ? { min: est[c]![0], max: est[c]![1] } : null),
    );

  it('distribui o orçamento sem perder centavos', () => {
    const a = defaultAllocation(200);
    expect(Object.values(a).reduce((s, v) => s + v, 0)).toBeCloseTo(200, 2);
    expect(a.lodging).toBe(88);
    expect(defaultAllocation(100.01).buffer).toBeGreaterThan(0);
  });

  it('calcula noites e quartos', () => {
    expect(nightsBetween('2026-11-21', '2026-11-22')).toBe(1);
    expect(nightsBetween('2026-12-01', '2026-12-31')).toBe(30);
    expect(nightsBetween('2026-11-21', '2026-11-21')).toBe(1);
    expect(roomsFor(1)).toBe(1);
    expect(roomsFor(3)).toBe(2);
  });

  it('estima hospedagem por noite e por quarto; sem preço devolve nulo', () => {
    expect(lodgingEstimate({ price_min: 60, price_max: 90 }, 2, 3)).toEqual({ min: 240, max: 360 });
    expect(lodgingEstimate({ price_min: null, price_max: null }, 2, 2)).toBeNull();
  });

  it('o cenário de €200 com custo mínimo de €190 cabe, mas apertado', () => {
    const ev = evaluate(
      200,
      full({ lodging: [70, 110], food: [50, 90], transport: [40, 60], activities: [30, 60], buffer: null }),
    );
    expect(ev.usable).toBe(190);
    expect(ev.needMin).toBe(190);
    expect(ev.deficit).toBe(0);
    expect(ev.verdict).toBe('tight');
  });

  it('nunca esconde um déficit', () => {
    const ev = evaluate(
      200,
      full({ lodging: [120, 160], food: [50, 90], transport: [40, 60], activities: [30, 60], buffer: null }),
    );
    expect(ev.verdict).toBe('deficit');
    expect(ev.deficit).toBe(50);
  });

  it('cabe só no mínimo => apertado; sobra folga no máximo => viável', () => {
    const tight = evaluate(
      1000,
      full({
        lodging: [400, 700],
        food: [200, 300],
        transport: [100, 150],
        activities: [100, 150],
        buffer: null,
      }),
    );
    expect(tight.verdict).toBe('tight');
    const ok = evaluate(
      5000,
      full({
        lodging: [400, 700],
        food: [200, 300],
        transport: [100, 150],
        activities: [100, 150],
        buffer: null,
      }),
    );
    expect(ok.verdict).toBe('viable');
  });

  it('sem estimativa suficiente a conclusão é desconhecida, mas um déficit parcial já conta', () => {
    expect(
      evaluate(
        1000,
        full({ lodging: [100, 200], food: null, transport: null, activities: null, buffer: null }),
      ).verdict,
    ).toBe('unknown');
    const partial = evaluate(
      100,
      full({ lodging: [500, 600], food: null, transport: null, activities: null, buffer: null }),
    );
    expect(partial.verdict).toBe('deficit');
    expect(partial.missing).toContain('food');
  });

  it('detecta valor planejado acima do total e reserva abaixo do mínimo', () => {
    const lines = full(
      { lodging: [10, 20], food: [10, 20], transport: [10, 20], activities: [10, 20], buffer: null },
      100,
    );
    const ev = evaluate(300, lines);
    expect(ev.overAllocated).toBe(200);
    const small = evaluate(
      1000,
      full(
        { lodging: [10, 20], food: [10, 20], transport: [10, 20], activities: [10, 20], buffer: null },
        10,
      ),
    );
    expect(small.lines.find((l) => l.category === 'buffer')?.level).toBe('short');
    expect(BUFFER_SHARE).toBe(0.05);
  });

  it('sugere ajustes só quando há déficit ou aperto, citando região mais barata', () => {
    const ev = evaluate(
      200,
      full({ lodging: [120, 160], food: [50, 90], transport: [40, 60], activities: [30, 60], buffer: null }),
    );
    const tips = suggestions(ev, 'EUR', 2, 2, [
      { name: 'Centro', price_min: 120, price_max: 160, chosen: true },
      { name: 'Bairro B', price_min: 70, price_max: 90, chosen: false },
    ]);
    expect(tips.join(' ')).toMatch(/Bairro B/);
    expect(
      suggestions(
        evaluate(
          9000,
          full({ lodging: [1, 2], food: [1, 2], transport: [1, 2], activities: [1, 2], buffer: null }),
        ),
        'EUR',
        1,
        2,
        [],
      ),
    ).toEqual([]);
  });
});

describe('parseRegions e parseEstimate', () => {
  it('valida cada região, limita a 3 e descarta faixas de preço incoerentes', () => {
    const r = (name: string, extra = {}) => ({ name, summary: 's', pros: ['a'], cons: ['b'], ...extra });
    const out = parseRegions({
      regions: [
        r('A', { price_min: 50, price_max: 80 }),
        r('B', { price_min: 90, price_max: 10 }),
        { nome: 'sem campos' },
        r('a'),
        r('C'),
        r('D'),
      ],
    });
    expect(out.map((x) => x.name)).toEqual(['A', 'B', 'C']);
    expect(out[0].price_min).toBe(50);
    expect(out[1].price_min).toBeUndefined();
    expect(parseRegions(null)).toEqual([]);
  });

  it('aceita estimativas coerentes e rejeita max < min', () => {
    const range = { min: 10, max: 20 };
    expect(parseEstimate({ food: range, transport: range, activities: range })).not.toBeNull();
    expect(parseEstimate({ food: { min: 30, max: 20 }, transport: range, activities: range })).toBeNull();
    expect(parseEstimate({ food: range })).toBeNull();
  });
});
