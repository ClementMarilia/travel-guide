import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { baseSubmitProblems, buildBaseContent } from '../../src/planning/base.js';
import { buildConstraintsContent, submitProblems } from '../../src/planning/constraints.js';
import { routeSubmitProblems } from '../../src/planning/route.js';
import { base, baseFacts, baseProposal, constraints, route } from '../helpers/fixtures.js';

const travelers = [
  { name: 'Ele', nonNegotiable: 'nenhum passeio começando às 7h' },
  { name: 'Eu', nonNegotiable: 'uma refeição boa por dia' },
];

describe('constraints', () => {
  const proposal = (({ nonNegotiables, conflicts, source, ...rest }) => rest)(constraints());
  const interview = {
    answers: [],
    pending: null,
    summary: 'resumo',
    conflicts: [{ description: 'orçamento vs refeição', involves: ['Eu'] }],
  };
  const source = { interviewStageId: 'i1', interviewVersion: 1 };

  it('copies the non-negotiables from the travelers, not from the model', () => {
    const content = buildConstraintsContent(proposal, travelers, interview, source);

    assert.deepEqual(content.nonNegotiables, [
      { traveler: 'Ele', text: 'nenhum passeio começando às 7h' },
      { traveler: 'Eu', text: 'uma refeição boa por dia' },
    ]);
  });

  it('carries the interview conflicts with no resolution yet', () => {
    const content = buildConstraintsContent(proposal, travelers, interview, source);

    assert.deepEqual(content.conflicts, [{ description: 'orçamento vs refeição', involves: ['Eu'], resolution: null }]);
  });

  it('blocks submission until every conflict has a resolution', () => {
    const content = buildConstraintsContent(proposal, travelers, interview, source);
    assert.match(submitProblems(content, travelers).join(' '), /conflict needs a resolution/);

    content.conflicts[0]!.resolution = 'gastar mais em refeições';
    assert.deepEqual(submitProblems(content, travelers), []);
  });

  it('blocks submission when the travelers changed after the constraints were generated', () => {
    const content = buildConstraintsContent(proposal, travelers, { ...interview, conflicts: [] }, source);

    assert.deepEqual(submitProblems(content, travelers), []);
    assert.match(
      submitProblems(content, [travelers[0]!, { name: 'Eu', nonNegotiable: 'duas refeições boas' }]).join(' '),
      /no longer match/,
    );
    assert.match(submitProblems(content, travelers.slice(0, 1)).join(' '), /no longer match/);
    assert.match(submitProblems(content, [...travelers, { name: 'Novo', nonNegotiable: 'x' }]).join(' '), /no longer match/);
  });
});

describe('base', () => {
  it('verifies the price of a neighborhood only when a sourced fact backs it', () => {
    const content = base();
    const alfama = content.neighborhoods.find((n) => n.name === 'Alfama')!;
    const baixa = content.neighborhoods.find((n) => n.name === 'Baixa')!;

    assert.equal(alfama.cost.status, 'VERIFIED');
    assert.equal(alfama.cost.amount, 120);
    assert.equal(alfama.cost.sourceUrl, 'https://example.com/hotel');
    assert.equal(alfama.verified, true);
    assert.equal(baixa.cost.status, 'NOT_VERIFIED');
    assert.equal(baixa.cost.amount, null);
    assert.equal(baixa.verified, false);
  });

  it('drops references to facts that do not exist', () => {
    const withFake = {
      ...baseProposal,
      neighborhoods: [{ ...baseProposal.neighborhoods[0]!, factIds: ['F1', 'F99'] }, baseProposal.neighborhoods[1]!],
    };
    const content = buildBaseContent(withFake, baseFacts, [], { constraintsStageId: 'c', constraintsVersion: 1 });

    assert.deepEqual(content.neighborhoods[0]!.factIds, ['F1']);
  });

  it('lists facts with no source as not verified', () => {
    assert.ok(base().couldNotVerify.some((note) => note.startsWith('F3 sem fonte')));
  });

  it('requires the recommendation to be one of the compared neighborhoods', () => {
    const content = base();
    assert.deepEqual(baseSubmitProblems(content), []);

    content.recommendation.neighborhood = 'Belém';
    assert.match(baseSubmitProblems(content).join(' '), /one of the compared/);
  });
});

describe('route', () => {
  const find = (name: string) => route().attractions.find((a) => a.name === name)!;

  it('reports "needs a reservation" only when a sourced fact says so', () => {
    assert.equal(find('Castelo de São Jorge').reservation.required, true);
    assert.equal(find('Mosteiro dos Jerónimos').reservation.required, null);
    assert.equal(find('Mosteiro dos Jerónimos').reservation.verified, false);
  });

  it('applies the price rule to tickets', () => {
    assert.equal(find('Castelo de São Jorge').ticket.status, 'VERIFIED');
    assert.equal(find('Castelo de São Jorge').ticket.sourceUrl, 'https://example.com/castle');
    assert.equal(find('Mosteiro dos Jerónimos').ticket.status, 'NOT_VERIFIED');
    assert.equal(find('Mosteiro dos Jerónimos').ticket.amount, null);
  });

  it('flags hours and travel times that have no source', () => {
    assert.equal(find('Castelo de São Jorge').hours.verified, true);
    assert.equal(find('Castelo de São Jorge').timesVerified, true);
    assert.equal(find('Mosteiro dos Jerónimos').hours.verified, false);
    assert.equal(find('Mosteiro dos Jerónimos').timesVerified, false);
  });

  it('adds a cluster for an attraction the model did not list one for', () => {
    const content = route();

    assert.deepEqual(content.clusters.map((c) => c.name), ['Centro', 'Belém', 'Orfã']);
    assert.equal(content.clusters[2]!.order, 3);
  });

  it('requires unique attraction names to submit', () => {
    const content = route();
    assert.deepEqual(routeSubmitProblems(content), []);

    content.attractions.push({ ...content.attractions[0]!, name: 'castelo de são jorge' });
    assert.match(routeSubmitProblems(content).join(' '), /must be unique/);
  });
});
