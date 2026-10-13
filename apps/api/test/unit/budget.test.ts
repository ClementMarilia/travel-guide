import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { budgetSubmitProblems, collectStageItems, findRisks, summarize } from '../../src/planning/budget.js';
import { base, budget, budgetDraft, budgetInputs, route, validDays } from '../helpers/fixtures.js';

const item = (content: ReturnType<typeof budgetDraft>, id: string) => content.items.find((i) => i.id === id)!;
const category = (content: ReturnType<typeof budgetDraft>, name: string) => content.categories.find((c) => c.category === name)!;

describe('collectStageItems', () => {
  it('prices the recommended base, the scheduled attractions and one meal per day', () => {
    const items = collectStageItems(base(), route(), validDays());

    assert.deepEqual(items.map((i) => i.id), ['LOD1', 'ATR1', 'ATR2', 'MEAL1', 'MEAL2', 'MEAL3']);
    assert.equal(items[0]!.label, 'Hospedagem em Alfama');
  });

  it('leaves out attractions that are not scheduled as priorities', () => {
    const items = collectStageItems(base(), route(), { ...validDays(), days: validDays().days.map((d) => ({ ...d, priorities: [] })) });

    assert.deepEqual(items.map((i) => i.id), ['LOD1', 'MEAL1', 'MEAL2', 'MEAL3']);
  });
});

describe('budget arithmetic', () => {
  const draft = budgetDraft();

  it('multiplies each verified price by the quantity its unit implies', () => {
    assert.equal(item(draft, 'LOD1').subtotal, 240); // 120 × 2 nights × 1 room
    assert.equal(item(draft, 'ATR1').subtotal, 30); // 15 × 2 people
    assert.equal(item(draft, 'MEAL1').subtotal, 36); // 18 × 2 people
    assert.equal(item(draft, 'TRN1').subtotal, 40.8); // 6.8 × 3 days × 2 people
  });

  it('shows the formula used', () => {
    assert.equal(item(draft, 'LOD1').formula, '120 EUR × 2 (PER_NIGHT)');
  });

  it('supports every unit', () => {
    const units = [
      ['PER_NIGHT', 4], ['PER_PERSON_PER_NIGHT', 4], ['PER_PERSON', 2], ['PER_PERSON_PER_DAY', 6], ['PER_DAY', 3], ['TOTAL', 1],
    ] as const;

    for (const [unit, quantity] of units) {
      const content = budgetDraft({
        inputs: { rooms: 2 },
        proposal: { units: [{ itemId: 'LOD1', unit }] },
      });
      assert.equal(item(content, 'LOD1').quantity, quantity, unit);
    }
  });

  it('counts only verified prices and totals them per category', () => {
    assert.equal(category(draft, 'LODGING').verifiedTotal, 240);
    assert.equal(category(draft, 'FOOD').verifiedTotal, 72);
    assert.equal(category(draft, 'ATTRACTIONS').verifiedTotal, 30);
    assert.equal(category(draft, 'TRANSPORT').verifiedTotal, 40.8);
    assert.equal(draft.totals.verifiedTotal, 382.8);
    assert.equal(draft.totals.countedItems, 5);
    assert.equal(draft.totals.uncountedItems, 3);
  });

  it('leaves unverified prices out with a reason, never filling them in', () => {
    for (const id of ['ATR2', 'MEAL2', 'TRN2']) {
      const excluded = item(draft, id);

      assert.equal(excluded.counted, false, id);
      assert.equal(excluded.subtotal, null, id);
      assert.equal(excluded.unitPrice.amount, null, id);
      assert.match(excluded.excludedReason ?? '', /NÃO VERIFICADO/, id);
    }
  });

  it('excludes a price whose unit the model could not identify', () => {
    const content = budgetDraft({ proposal: { units: [{ itemId: 'LOD1', unit: null }] } });

    assert.equal(item(content, 'LOD1').counted, false);
    assert.match(item(content, 'LOD1').excludedReason ?? '', /Unidade/);
    assert.equal(category(content, 'LODGING').verifiedTotal, 0);
  });

  it('excludes a verified price in another currency without converting it', () => {
    const content = budgetDraft({ inputs: { currency: 'USD' } });

    assert.equal(item(content, 'LOD1').counted, false);
    assert.match(item(content, 'LOD1').excludedReason ?? '', /sem conversão/);
    assert.equal(content.totals.verifiedTotal, 0);
  });

  it('splits the total by the proposed percentages', () => {
    assert.equal(category(draft, 'LODGING').allocated, 1350);
    assert.equal(category(draft, 'CONTINGENCY').allocated, 450);
    assert.equal(draft.totals.allocatedTotal, 3000);
  });

  it('scales percentages that do not add up to 100 and says so', () => {
    const content = budgetDraft({ proposal: { allocation: { LODGING: 90, FOOD: 40, ATTRACTIONS: 20, TRANSPORT: 20, CONTINGENCY: 30 } } });

    assert.equal(content.totals.allocatedTotal, 3000);
    assert.match(content.warnings.join(' '), /ajustada/);
  });

  it('warns about a contingency margin below the minimum', () => {
    const content = budgetDraft({ proposal: { allocation: { LODGING: 50, FOOD: 25, ATTRACTIONS: 12, TRANSPORT: 10, CONTINGENCY: 3 } } });

    assert.match(content.warnings.join(' '), /abaixo do mínimo/);
  });
});

describe('budget risks', () => {
  const ids = (content: ReturnType<typeof budgetDraft>) => content.risks.map((r) => r.id).sort();

  it('flags unverified items and the partial scope of food', () => {
    const content = budgetDraft();

    assert.deepEqual(ids(content), ['ATTRACTIONS-LOW_COVERAGE', 'FOOD-LOW_COVERAGE', 'FOOD-PARTIAL_SCOPE', 'TRANSPORT-LOW_COVERAGE']);
  });

  it('rates coverage risk by the share of unverified items', () => {
    const content = budgetDraft();
    const severity = (id: string) => content.risks.find((r) => r.id === id)!.severity;

    assert.equal(severity('FOOD-LOW_COVERAGE'), 'MEDIUM'); // 1 of 3
    assert.equal(severity('ATTRACTIONS-LOW_COVERAGE'), 'HIGH'); // 1 of 2
    assert.equal(severity('TRANSPORT-LOW_COVERAGE'), 'HIGH'); // 1 of 2
  });

  it('flags a category whose verified prices exceed what was set aside', () => {
    const content = budgetDraft({ inputs: { people: 30 } });
    const over = content.risks.filter((r) => r.kind === 'OVER_ALLOCATION');

    assert.deepEqual(over.map((r) => r.category).sort(), ['ATTRACTIONS', 'FOOD', 'TRANSPORT']);
    assert.ok(over.every((r) => r.severity === 'HIGH'));
  });

  it('flags a category above 80% of its allocation', () => {
    const categories = [
      { category: 'FOOD' as const, percent: 20, allocated: 100, verifiedTotal: 85, countedItems: 1, uncountedItems: 0, remaining: 15 },
    ];
    const risks = findRisks(categories, budgetInputs);

    assert.ok(risks.some((r) => r.id === 'FOOD-NEAR_LIMIT' && r.severity === 'MEDIUM'));
    assert.ok(!risks.some((r) => r.id === 'FOOD-OVER_ALLOCATION'));
  });

  it('treats a transport category with no price at all as a high risk', () => {
    const content = budgetDraft({ proposal: { transport: [] } });
    const risk = content.risks.find((r) => r.id === 'TRANSPORT-LOW_COVERAGE');

    assert.equal(risk?.severity, 'HIGH');
    assert.match(risk?.detail ?? '', /Nenhum preço de transporte/);
  });

  it('writes the numbers into the risk detail', () => {
    const content = budgetDraft({ inputs: { people: 30 } });

    assert.match(content.risks.find((r) => r.id === 'FOOD-OVER_ALLOCATION')!.detail, /1080\.00 EUR.*600\.00 EUR/);
  });
});

describe('budgetSubmitProblems', () => {
  it('accepts a complete budget', () => {
    assert.deepEqual(budgetSubmitProblems(budget()), []);
  });

  it('requires a decision for every risk', () => {
    const content = budget();
    content.risks[0]!.decision = null;
    content.risks[1]!.decision = '   ';

    const problems = budgetSubmitProblems(content);
    assert.equal(problems.filter((p) => /no decision/.test(p)).length, 2);
  });

  it('refuses a counted item that lacks a link, date or verified status', () => {
    for (const edit of [{ sourceUrl: null }, { consultedAt: null }, { currency: null }, { status: 'NOT_VERIFIED' as const }]) {
      const content = budget();
      const target = content.items.find((i) => i.id === 'LOD1')!;
      target.unitPrice = { ...target.unitPrice, ...edit };

      assert.match(budgetSubmitProblems(content).join(' '), /counted without a source/, JSON.stringify(edit));
    }
  });

  it('refuses a counted item in a different currency', () => {
    const content = budget();
    const target = content.items.find((i) => i.id === 'LOD1')!;
    target.unitPrice = { ...target.unitPrice, currency: 'USD' };

    assert.match(budgetSubmitProblems(content).join(' '), /not EUR/);
  });

  it('refuses totals that do not match the items', () => {
    const content = budget();
    content.totals.verifiedTotal = 1;

    assert.match(budgetSubmitProblems(content).join(' '), /totals do not match/);
  });

  it('refuses a missing contingency margin or percentages that do not add up', () => {
    const lowMargin = budget();
    lowMargin.categories.find((c) => c.category === 'CONTINGENCY')!.percent = 2;
    assert.match(budgetSubmitProblems(lowMargin).join(' '), /at least 5%/);

    const notHundred = budget();
    notHundred.categories.find((c) => c.category === 'FOOD')!.percent = 50;
    assert.match(budgetSubmitProblems(notHundred).join(' '), /add up to 100/);
  });

  it('recomputes totals from the items, so editing a subtotal is caught', () => {
    const content = budget();
    content.items.find((i) => i.id === 'LOD1')!.subtotal = 1;

    assert.match(budgetSubmitProblems(content).join(' '), /totals do not match/);
  });
});

describe('summarize', () => {
  it('ignores uncounted items even if they carry a subtotal', () => {
    const content = budget();
    const sneaky = { ...content.items.find((i) => i.id === 'ATR2')!, subtotal: 9999 };
    const percents = { LODGING: 45, FOOD: 20, TRANSPORT: 10, ATTRACTIONS: 10, CONTINGENCY: 15 };

    const { totals } = summarize([...content.items.filter((i) => i.id !== 'ATR2'), sneaky], percents, content.inputs);
    assert.equal(totals.verifiedTotal, content.totals.verifiedTotal);
  });
});
