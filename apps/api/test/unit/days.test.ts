import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { daysSubmitProblems } from '../../src/planning/days.js';
import {
  CASTLE,
  MONASTERY,
  dayProposal,
  days,
  meal,
  validDays,
} from '../helpers/fixtures.js';

const morning = (attraction: string, start = '09:30') => ({ attraction, slot: 'MORNING' as const, start, durationMinutes: 60 });

describe('buildDaysContent', () => {
  it('keeps at most the allowed number of priorities per day, moving the rest to flexible options', () => {
    const content = days([dayProposal(1, [morning(CASTLE), morning(MONASTERY, '11:00')])], 1);

    assert.deepEqual(content.days[0]!.priorities.map((p) => p.attraction), [CASTLE]);
    assert.deepEqual(content.days[0]!.flexibleOptions, [MONASTERY]);
    assert.match(content.warnings.join(' '), /over the limit of 1/);
  });

  it('schedules an attraction only once', () => {
    const content = days([dayProposal(1, [morning(CASTLE)]), dayProposal(2, [morning(CASTLE)])]);

    assert.equal(content.days[1]!.priorities.length, 0);
    assert.match(content.warnings.join(' '), /already scheduled/);
  });

  it('drops attractions that are not in the approved route', () => {
    const content = days([dayProposal(1, [morning('Atração Fantasma'), morning(CASTLE)])]);

    assert.deepEqual(content.days[0]!.priorities.map((p) => p.attraction), [CASTLE]);
    assert.match(content.warnings.join(' '), /not in the approved route/);
  });

  it('computes each date from the trip start and ignores days outside the trip or repeated', () => {
    const content = days([dayProposal(1, []), dayProposal(2, []), dayProposal(2, []), dayProposal(4, [])]);

    assert.deepEqual(content.days.map((d) => d.date), ['2026-11-01', '2026-11-02']);
    assert.equal(content.warnings.filter((w) => /ignored/.test(w)).length, 2);
  });

  it('warns about a start before the time the travelers wanted to avoid', () => {
    const content = days([dayProposal(1, [morning(CASTLE, '06:30')])]);

    assert.match(content.warnings.join(' '), /starts at 06:30, before 09:00/);
  });

  it('keeps travel minutes only when a sourced fact backs them', () => {
    const content = days([
      dayProposal(1, [], {
        travel: [
          { from: 'A', to: 'B', minutes: 35, mode: 'metrô', factIds: ['F1'] },
          { from: 'B', to: 'C', minutes: 20, mode: 'a pé', factIds: [] },
          { from: 'C', to: 'D', minutes: 10, mode: 'a pé', factIds: ['F3'] },
        ],
      }),
    ]);

    assert.deepEqual(content.days[0]!.travel.map((t) => [t.minutes, t.verified]), [[35, true], [null, false], [null, false]]);
  });

  it('applies the price rule to the meal and flags missing sources', () => {
    const content = days([dayProposal(1, [], { meal: meal('Taberna X', 18, 'F2') }), dayProposal(2, [], { meal: meal('Cantina Y', 20, 'F3') })]);

    assert.equal(content.days[0]!.meal.price.status, 'VERIFIED');
    assert.equal(content.days[0]!.meal.verified, true);
    assert.equal(content.days[1]!.meal.price.status, 'NOT_VERIFIED');
    assert.equal(content.days[1]!.meal.price.amount, null);
    assert.equal(content.days[1]!.meal.verified, false);
  });

  it('flags the rain plan when no fact backs it', () => {
    const content = days([dayProposal(1, [], { rainPlan: { text: 'ficar no hotel', factIds: [] } })]);

    assert.equal(content.days[0]!.rainPlan.verified, false);
  });

  it('flags reservations: required only when a source confirms, otherwise unknown', () => {
    const content = validDays();

    assert.deepEqual(
      content.reservations.map((r) => [r.attraction, r.day, r.status]),
      [[CASTLE, 1, 'REQUIRED'], [MONASTERY, 2, 'UNKNOWN']],
    );
  });

  it('records the attraction to rethink as an assessment, with whether evidence backs it', () => {
    const content = validDays();

    assert.equal(content.skipSuggestion.kind, 'ASSESSMENT');
    assert.equal(content.skipSuggestion.criterion, 'QUEUE');
    assert.equal(content.skipSuggestion.evidenceVerified, true);
  });

  it('lists as unscheduled only route attractions that really are unscheduled', () => {
    const content = days(
      [dayProposal(1, [morning(CASTLE)])],
      2,
      3,
      [
        { attraction: MONASTERY, reason: 'não coube' },
        { attraction: CASTLE, reason: 'já está agendado' },
        { attraction: 'Fantasma', reason: 'não existe' },
      ],
    );

    assert.deepEqual(content.unscheduled, [{ attraction: MONASTERY, reason: 'não coube' }]);
  });

  it('snapshots the limits and the times to avoid', () => {
    const { limits } = validDays();

    assert.deepEqual(limits, { days: 3, maxPrioritiesPerDay: 2, notBefore: '09:00', notAfter: null, mustHave: [CASTLE, MONASTERY] });
  });
});

describe('daysSubmitProblems', () => {
  it('accepts a complete plan', () => {
    assert.deepEqual(daysSubmitProblems(validDays()), []);
  });

  it('requires the exact number of days', () => {
    const content = validDays();
    content.days.pop();

    assert.match(daysSubmitProblems(content).join(' '), /Expected 3 days, found 2/);
  });

  it('catches hand edits that exceed the daily limit or repeat an attraction', () => {
    const tooMany = validDays();
    tooMany.limits.maxPrioritiesPerDay = 1;
    tooMany.days[0]!.priorities.push({ ...tooMany.days[0]!.priorities[0]!, attraction: 'Outra' });
    assert.match(daysSubmitProblems(tooMany).join(' '), /more than 1 priorities/);

    const twice = validDays();
    twice.days[2]!.priorities.push({ ...twice.days[0]!.priorities[0]! });
    assert.match(daysSubmitProblems(twice).join(' '), /scheduled more than once/);
  });

  it('requires every must-see attraction to be scheduled or explained', () => {
    const content = validDays();
    content.days[1]!.priorities = [];
    assert.match(daysSubmitProblems(content).join(' '), new RegExp(`${MONASTERY} is a must-see`));

    content.unscheduled = [{ attraction: MONASTERY, reason: 'fecha na data' }];
    assert.deepEqual(daysSubmitProblems(content), []);
  });

  it('refuses a start before the time to avoid, after any edit', () => {
    const content = validDays();
    content.days[0]!.priorities[0]!.start = '07:00';

    assert.match(daysSubmitProblems(content).join(' '), /starts at 07:00, before 09:00/);
  });

  it('refuses a visit that ends after the latest allowed time', () => {
    const content = validDays();
    content.limits.notAfter = '10:00';
    content.days[0]!.priorities[0]!.durationMinutes = 90;

    assert.match(daysSubmitProblems(content).join(' '), /ends after 10:00/);
  });

  it('requires a place to eat and a rain plan on every day', () => {
    const content = validDays();
    content.days[0]!.meal.name = ' ';
    content.days[1]!.rainPlan.text = '';

    const problems = daysSubmitProblems(content).join(' ');
    assert.match(problems, /Day 1 has no place to eat/);
    assert.match(problems, /Day 2 has no rain plan/);
  });
});
