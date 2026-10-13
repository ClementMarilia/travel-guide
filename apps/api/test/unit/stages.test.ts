import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canStartStage, previousStage, resolvePrice, STAGE_ORDER, type Stage } from '../../src/planning/stages.js';

describe('stage order', () => {
  it('runs interview first and verification last', () => {
    assert.deepEqual([...STAGE_ORDER], ['INTERVIEW', 'CONSTRAINTS', 'BASE', 'ROUTE', 'DAYS', 'BUDGET', 'VERIFICATION']);
    assert.equal(previousStage('INTERVIEW'), null);
    assert.equal(previousStage('VERIFICATION'), 'BUDGET');
  });

  it('lets the interview start with nothing approved', () => {
    assert.equal(canStartStage('INTERVIEW', new Set()), true);
  });

  it('blocks every later stage until the previous one is approved', () => {
    for (const stage of STAGE_ORDER.slice(1)) {
      assert.equal(canStartStage(stage, new Set()), false, `${stage} must not start with nothing approved`);
    }
  });

  it('does not let an earlier approval unlock a skipped stage', () => {
    const approved = new Set<Stage>(['INTERVIEW']);

    assert.equal(canStartStage('CONSTRAINTS', approved), true);
    assert.equal(canStartStage('BASE', approved), false);
    assert.equal(canStartStage('VERIFICATION', new Set<Stage>(['INTERVIEW', 'CONSTRAINTS', 'BASE', 'ROUTE', 'DAYS'])), false);
  });
});

describe('resolvePrice', () => {
  const full = { amount: 120, currency: 'eur', sourceUrl: 'https://example.com/hotel', consultedAt: '2026-10-12' };

  it('verifies a price that has amount, currency, link and date', () => {
    const price = resolvePrice(full);

    assert.equal(price.status, 'VERIFIED');
    assert.equal(price.amount, 120);
    assert.equal(price.currency, 'EUR');
    assert.equal(price.sourceUrl, 'https://example.com/hotel');
    assert.ok(price.consultedAt instanceof Date);
  });

  for (const missing of ['amount', 'currency', 'sourceUrl', 'consultedAt'] as const) {
    it(`drops the price when ${missing} is missing`, () => {
      const price = resolvePrice({ ...full, [missing]: undefined });

      assert.deepEqual(price, { status: 'NOT_VERIFIED', amount: null, currency: null, sourceUrl: null, consultedAt: null });
    });
  }

  it('rejects links that are not http(s), bad currencies and negative amounts', () => {
    assert.equal(resolvePrice({ ...full, sourceUrl: 'javascript:alert(1)' }).status, 'NOT_VERIFIED');
    assert.equal(resolvePrice({ ...full, sourceUrl: 'ftp://example.com/x' }).status, 'NOT_VERIFIED');
    assert.equal(resolvePrice({ ...full, currency: 'EURO' }).status, 'NOT_VERIFIED');
    assert.equal(resolvePrice({ ...full, amount: -5 }).status, 'NOT_VERIFIED');
    assert.equal(resolvePrice({ ...full, consultedAt: 'not a date' }).status, 'NOT_VERIFIED');
  });

  it('never fills in an amount by itself', () => {
    assert.equal(resolvePrice({}).amount, null);
  });
});
