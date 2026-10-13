import { buildBaseContent, type BaseContent, type BaseProposal } from '../../src/planning/base.js';
import type { ConstraintsContent } from '../../src/planning/constraints.js';
import { buildDaysContent, type DaysContent, type DaysProposal } from '../../src/planning/days.js';
import type { Fact } from '../../src/planning/research.js';
import { buildRouteContent, type RouteContent, type RouteProposal } from '../../src/planning/route.js';

export const NOW = '2026-10-12T10:00:00.000Z';

export function fact(id: string, category: Fact['category'], text: string, urls: string[] = []): Fact {
  return {
    id,
    category,
    text,
    sources: urls.map((url) => ({ url, title: new URL(url).host, direct: true, consultedAt: NOW })),
  };
}

export function constraints(over: Partial<ConstraintsContent> = {}): ConstraintsContent {
  return {
    budget: { total: 3000, currency: 'EUR', notes: '' },
    pace: { maxPrioritiesPerDay: 2, freeAfternoons: true, notes: '' },
    food: { restrictions: [], notes: '' },
    mobility: { notes: '' },
    avoidTimes: [{ description: 'acordar cedo', notBefore: '09:00', notAfter: null }],
    nonNegotiables: [
      { traveler: 'Ele', text: 'nenhum passeio começando às 7h' },
      { traveler: 'Eu', text: 'uma refeição boa por dia' },
    ],
    conflicts: [],
    source: { interviewStageId: 'interview-1', interviewVersion: 1 },
    ...over,
  };
}

export const HOTEL_URL = 'https://example.com/hotel';
export const CASTLE_URL = 'https://example.com/castle';
export const FOOD_URL = 'https://example.com/food';

export const baseFacts: Fact[] = [
  fact('F1', 'CUSTO', 'Alfama: diária média de 120 EUR', [HOTEL_URL]),
  fact('F2', 'DESLOCAMENTO', 'Alfama: 15 min de metrô', [HOTEL_URL]),
  fact('F3', 'CUSTO', 'Baixa: diária média de 90 EUR'),
];

export const baseProposal: BaseProposal = {
  regions: [{ name: 'Centro', places: ['Castelo'] }],
  neighborhoods: [
    {
      name: 'Alfama',
      commuteSummary: '15 min',
      access: 'metrô',
      paceFit: 'bom',
      cost: { text: '120 EUR/diária', amount: 120, currency: 'EUR', factIds: ['F1'] },
      factIds: ['F1', 'F2'],
    },
    {
      name: 'Baixa',
      commuteSummary: 'n/d',
      access: 'metrô',
      paceFit: 'médio',
      cost: { text: '90 EUR/diária', amount: 90, currency: 'EUR', factIds: ['F3'] },
      factIds: ['F3'],
    },
  ],
  recommendation: { neighborhood: 'Alfama', reasoning: 'menos deslocamento' },
  discarded: [{ neighborhood: 'Baixa', reason: 'sem fonte' }],
  couldNotVerify: [],
};

export function base(): BaseContent {
  return buildBaseContent(baseProposal, baseFacts, [], { constraintsStageId: 'c1', constraintsVersion: 1 });
}

export const routeFacts: Fact[] = [
  fact('F1', 'DESLOCAMENTO', 'Castelo: 20 min a pé desde Alfama', [CASTLE_URL]),
  fact('F2', 'HORARIO', 'Castelo: abre às 9h e fecha às 21h', [CASTLE_URL]),
  fact('F3', 'RESERVA', 'Castelo: recomenda-se comprar online', [CASTLE_URL]),
  fact('F4', 'CUSTO', 'Castelo: ingresso 15 EUR', [CASTLE_URL]),
  fact('F5', 'HORARIO', 'Mosteiro: abre às 10h'),
  fact('F6', 'CUSTO', 'Mosteiro: ingresso 12 EUR'),
  fact('F7', 'RESERVA', 'Mosteiro: reserva obrigatória'),
];

const attraction = (
  name: string,
  cluster: string,
  priority: 'MUST' | 'NICE',
  hours: string[],
  reservation: string[],
  ticket: { amount: number | null; factIds: string[] },
  factIds: string[],
): RouteProposal['attractions'][number] => ({
  name,
  cluster,
  priority,
  minutesFromBase: 20,
  travelMode: 'a pé',
  durationMinutes: 90,
  hours: { text: 'horário', factIds: hours },
  reservation: { required: true, text: 'reserva', factIds: reservation },
  ticket: { text: 'ingresso', amount: ticket.amount, currency: ticket.amount === null ? null : 'EUR', factIds: ticket.factIds },
  alerts: [],
  factIds,
});

export const routeProposal: RouteProposal = {
  clusters: [
    { name: 'Centro', order: 1, rationale: 'perto da base' },
    { name: 'Belém', order: 2, rationale: 'um dia à parte' },
  ],
  attractions: [
    attraction('Castelo de São Jorge', 'Centro', 'MUST', ['F2'], ['F3'], { amount: 15, factIds: ['F4'] }, ['F1', 'F2']),
    attraction('Mosteiro dos Jerónimos', 'Belém', 'MUST', ['F5'], ['F7'], { amount: 12, factIds: ['F6'] }, ['F5']),
    attraction('Torre de Belém', 'Orfã', 'NICE', [], [], { amount: null, factIds: [] }, []),
  ],
  couldNotVerify: [],
};

export function route(): RouteContent {
  return buildRouteContent(routeProposal, routeFacts, [], 'Alfama', { baseStageId: 'b1', baseVersion: 1 });
}

export const daysFacts: Fact[] = [
  fact('F1', 'DESLOCAMENTO', 'Castelo para Mosteiro: 35 min', [FOOD_URL]),
  fact('F2', 'ALIMENTACAO', 'Taberna X: pratos a 18 EUR', [FOOD_URL]),
  fact('F3', 'ALIMENTACAO', 'Cantina Y: pratos a 20 EUR'),
  fact('F4', 'FILA', 'Mosteiro: fila longa', [FOOD_URL]),
  fact('F5', 'CHUVA', 'Museu Z coberto', [FOOD_URL]),
];

export const meal = (name: string, amount: number, factId: string): DaysProposal['days'][number]['meal'] => ({
  name,
  near: 'rota',
  notes: '',
  price: { text: `${amount} EUR`, amount, currency: 'EUR', factIds: [factId] },
  factIds: [factId],
});

export function dayProposal(
  day: number,
  priorities: DaysProposal['days'][number]['priorities'],
  over: Partial<DaysProposal['days'][number]> = {},
): DaysProposal['days'][number] {
  return {
    day,
    theme: `Dia ${day}`,
    cluster: 'Centro',
    priorities,
    flexibleOptions: [],
    afternoonNote: 'livre',
    travel: [],
    meal: meal('Taberna X', 18, 'F2'),
    rainPlan: { text: 'Museu Z', factIds: ['F5'] },
    ...over,
  };
}

export const CASTLE = 'Castelo de São Jorge';
export const MONASTERY = 'Mosteiro dos Jerónimos';

export const skipSuggestion: DaysProposal['skipSuggestion'] = {
  attraction: MONASTERY,
  criterion: 'QUEUE',
  reasoning: 'o critério fila indica espera longa',
  factIds: ['F4'],
};

export function days(proposalDays: DaysProposal['days'], max = 2, total = 3, unscheduled: DaysProposal['unscheduled'] = []): DaysContent {
  return buildDaysContent(
    { days: proposalDays, unscheduled, skipSuggestion, couldNotVerify: [] },
    daysFacts,
    [],
    { route: route(), constraints: constraints(), startDate: new Date('2026-11-01T00:00:00Z'), days: total, maxPrioritiesPerDay: max },
    { routeStageId: 'r1', routeVersion: 1 },
  );
}

// Two days that satisfy every rule: both must-see attractions scheduled, valid times.
export function validDays(): DaysContent {
  return days([
    dayProposal(1, [{ attraction: CASTLE, slot: 'MORNING', start: '09:30', durationMinutes: 90 }]),
    dayProposal(2, [{ attraction: MONASTERY, slot: 'MORNING', start: '10:00', durationMinutes: 60 }], { meal: meal('Cantina Y', 20, 'F3') }),
    dayProposal(3, []),
  ]);
}

// ---- budget -------------------------------------------------------------------------------

import {
  buildBudgetContent,
  collectStageItems,
  type BudgetContent,
  type BudgetProposal,
} from '../../src/planning/budget.js';

export const TRANSPORT_URL = 'https://example.com/metro';

export const transportFacts: Fact[] = [
  fact('F1', 'CUSTO', 'Passe 24h metrô: 6,80 EUR por pessoa por dia', [TRANSPORT_URL]),
  fact('F2', 'CUSTO', 'Táxi aeroporto-centro: cerca de 20 EUR'),
];

export const budgetInputs = { currency: 'EUR', total: 3000, days: 3, nights: 2, people: 2, rooms: 1 };

export const budgetProposal: BudgetProposal = {
  units: [
    { itemId: 'LOD1', unit: 'PER_NIGHT' },
    { itemId: 'ATR1', unit: 'PER_PERSON' },
    { itemId: 'ATR2', unit: 'PER_PERSON' },
    { itemId: 'MEAL1', unit: 'PER_PERSON' },
    { itemId: 'MEAL2', unit: 'PER_PERSON' },
    { itemId: 'MEAL3', unit: 'PER_PERSON' },
  ],
  transport: [
    { label: 'Passe 24h', unit: 'PER_PERSON_PER_DAY', cost: { text: '6,80 EUR', amount: 6.8, currency: 'EUR', factIds: ['F1'] } },
    { label: 'Táxi aeroporto', unit: 'TOTAL', cost: { text: '20 EUR', amount: 20, currency: 'EUR', factIds: ['F2'] } },
  ],
  allocation: { LODGING: 45, FOOD: 20, ATTRACTIONS: 10, TRANSPORT: 10, CONTINGENCY: 15 },
  allocationReasoning: 'hospedagem pesa mais',
  couldNotVerify: [],
};

export function budgetDraft(over: { proposal?: Partial<BudgetProposal>; inputs?: Partial<typeof budgetInputs>; days?: DaysContent } = {}) {
  const inputs = { ...budgetInputs, ...over.inputs };
  const stageItems = collectStageItems(base(), route(), over.days ?? validDays());

  return buildBudgetContent({
    proposal: { ...budgetProposal, ...over.proposal },
    stageItems,
    facts: transportFacts,
    searchQueries: [],
    inputs,
    assumptions: [],
    source: { daysStageId: 'd1', daysVersion: 1 },
  });
}

// A budget that passes every rule: all risks have a decision.
export function budget(over: Parameters<typeof budgetDraft>[0] = {}): BudgetContent {
  const draft = budgetDraft(over);
  return { ...draft, risks: draft.risks.map((r) => ({ ...r, decision: `decisão para ${r.id}` })) };
}
