/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { FAKE_BAD_KEY, FAKE_GOOD_KEY } from '../helpers/fake-servers.js';
import { startTestApi, type Trip, type TestApi } from '../helpers/api.js';

let api: TestApi | null = null;
const skip = process.env.TEST_DATABASE_URL ? false : 'set TEST_DATABASE_URL to run the integration tests';

before(async () => {
  api = await startTestApi();
});

after(async () => {
  await api?.stop();
});

const message = (response: { body: any }) => String(response.body?.message ?? '');

async function addTravelers(trip: Trip) {
  await trip.post('/travelers', { name: 'Ele', nonNegotiable: 'nenhum passeio começando às 7h' });
  await trip.post('/travelers', { name: 'Eu', nonNegotiable: 'uma refeição boa por dia' });
}

// Runs the stages in order up to BUDGET (approved), the same way a user would.
async function advanceThroughBudget(trip: Trip) {
  await addTravelers(trip);
  await trip.runInterview();
  await trip.approve('INTERVIEW');

  assert.equal((await trip.post('/constraints/generate')).status, 201);
  await trip.edit('CONSTRAINTS', (c) => c.conflicts.forEach((x: any) => (x.resolution = 'aceitamos gastar mais em refeições')));
  await trip.approve('CONSTRAINTS');

  assert.equal((await trip.post('/base/generate')).status, 201);
  await trip.approve('BASE');
  assert.equal((await trip.post('/route/generate')).status, 201);
  await trip.approve('ROUTE');
  assert.equal((await trip.post('/days/generate')).status, 201);
  await trip.approve('DAYS');
  assert.equal((await trip.post('/budget/generate')).status, 201);
  await trip.edit('BUDGET', (c) => c.risks.forEach((r: any) => (r.decision ??= 'confirmar o preço antes de reservar')));
  await trip.approve('BUDGET');
}

describe('preconditions', { skip }, () => {
  it('does not interview without a destination, a traveler or an AI key', async () => {
    const user = await api!.newUser();
    const noDestination = await api!.newTrip(user, { destination: null });
    await addTravelers(noDestination);
    assert.match(message(await noDestination.post('/interview/answer')), /destination/);

    const noTravelers = await api!.newTrip(user);
    assert.match(message(await noTravelers.post('/interview/answer')), /traveler/);

    const noKey = await api!.newUser({ aiKey: null });
    const trip = await api!.newTrip(noKey);
    await addTravelers(trip);
    assert.match(message(await trip.post('/interview/answer')), /AI provider key/);
  });

  it('keeps the stage untouched when the AI provider rejects the key', async () => {
    const user = await api!.newUser({ aiKey: FAKE_BAD_KEY });
    const trip = await api!.newTrip(user);
    await addTravelers(trip);

    const failed = await trip.post('/interview/answer');
    assert.equal(failed.status, 422);
    assert.match(message(failed), /rejected your API key/);

    const stage = await trip.stage('INTERVIEW');
    assert.equal(stage.status, 'DRAFT');
    assert.deepEqual(stage.content, {});
  });
});

describe('stage order', { skip }, () => {
  it('refuses every stage until the previous one is approved', async () => {
    const user = await api!.newUser();
    const trip = await api!.newTrip(user);

    for (const stage of ['CONSTRAINTS', 'BASE', 'ROUTE', 'DAYS', 'BUDGET', 'VERIFICATION']) {
      const response = await trip.post('/stages', { stage });
      assert.equal(response.status, 409, stage);
      assert.match(message(response), /must be approved first/, stage);
    }

    for (const [path, previous] of [
      ['/constraints/generate', 'INTERVIEW'], ['/base/generate', 'CONSTRAINTS'], ['/route/generate', 'BASE'],
      ['/days/generate', 'ROUTE'], ['/budget/generate', 'DAYS'], ['/verification/generate', 'BUDGET'],
    ] as const) {
      const response = await trip.post(path);
      assert.equal(response.status, 409, path);
      assert.match(message(response), new RegExp(`Stage ${previous} must be approved first`), path);
    }
  });

  it('does not let a stage skip approval or be approved twice', async () => {
    const user = await api!.newUser();
    const trip = await api!.newTrip(user);
    const started = await trip.post('/stages', { stage: 'INTERVIEW' });
    const id = started.body.stage.id;

    assert.equal((await trip.post(`/stages/${id}/approve`)).status, 409); // draft cannot be approved
    assert.equal((await trip.post('/stages', { stage: 'INTERVIEW' })).status, 409); // already in progress
  });
});

describe('the full planning flow', { skip }, () => {
  let user: Awaited<ReturnType<TestApi['newUser']>>;
  let trip: Trip;

  before(async () => {
    user = await api!.newUser();
    trip = await api!.newTrip(user);
    await addTravelers(trip);
  });

  it('1. interviews one question at a time, then summarizes with conflicts', async () => {
    const first = await trip.post('/interview/answer');
    assert.equal(first.status, 200);
    assert.deepEqual([first.body.done, first.body.question.topic, first.body.question.number, first.body.question.total], [false, 'BUDGET', 1, 5]);

    assert.equal((await trip.post('/interview/answer')).status, 400); // an answer is required
    assert.equal((await trip.submit('INTERVIEW')).status, 409); // not finished yet
    assert.match(message(await trip.submit('INTERVIEW')), /Finish the interview/);

    const topics: string[] = [];
    let last: any;
    for (const answer of ['3000 euros', 'tranquilo', 'sem restrições', 'caminhamos bem', 'nada antes das 9h']) {
      last = await trip.post('/interview/answer', { answer });
      topics.push(last.body.question?.topic ?? 'DONE');
    }

    assert.deepEqual(topics, ['PACE', 'FOOD', 'MOBILITY', 'AVOID_TIMES', 'DONE']);
    assert.equal(last.body.done, true);
    assert.ok(last.body.summary);
    assert.equal(last.body.conflicts.length, 1);
    assert.equal((await trip.post('/interview/answer', { answer: 'x' })).status, 409);
  });

  it('1b. sends the travelers’ non-negotiables to the model and never puts the key in the URL', () => {
    const prompts = api!.gemini.requests.map((r) => JSON.stringify(r.body));

    assert.ok(prompts.some((p) => p.includes('nenhum passeio começando às 7h') && p.includes('uma refeição boa por dia')));
    assert.ok(api!.gemini.requests.every((r) => !r.url.includes(FAKE_GOOD_KEY) && r.key === FAKE_GOOD_KEY));
  });

  it('2. approves the interview, then builds constraints that need every conflict resolved', async () => {
    await trip.approve('INTERVIEW');

    const generated = await trip.post('/constraints/generate');
    assert.equal(generated.status, 201);
    const content = generated.body.stage.content;
    assert.deepEqual(content.nonNegotiables, [
      { traveler: 'Ele', text: 'nenhum passeio começando às 7h' },
      { traveler: 'Eu', text: 'uma refeição boa por dia' },
    ]);
    assert.equal(content.conflicts[0].resolution, null);

    assert.equal((await trip.post('/constraints/generate')).status, 409); // draft exists
    assert.match(message(await trip.submit('CONSTRAINTS')), /conflict needs a resolution/);
    assert.equal((await trip.edit('CONSTRAINTS', (c) => (c.budget = 'oops'))).status, 400);
  });

  it('2b. blocks the constraints when a traveler’s non-negotiable changes afterwards', async () => {
    await trip.edit('CONSTRAINTS', (c) => c.conflicts.forEach((x: any) => (x.resolution = 'aceitamos gastar mais em refeições')));

    const travelers = (await trip.get('/travelers')).body.travelers;
    const eu = travelers.find((t: any) => t.name === 'Eu');
    await trip.patch(`/travelers/${eu.id}`, { nonNegotiable: 'duas refeições boas por dia' });

    assert.match(message(await trip.submit('CONSTRAINTS')), /no longer match/);

    const regenerated = await trip.post('/constraints/generate', { regenerate: true });
    assert.equal(regenerated.status, 200);
    assert.ok(regenerated.body.stage.content.nonNegotiables.some((n: any) => n.text === 'duas refeições boas por dia'));

    await trip.edit('CONSTRAINTS', (c) => c.conflicts.forEach((x: any) => (x.resolution = 'aceitamos gastar mais em refeições')));
    await trip.approve('CONSTRAINTS');
  });

  it('3. researches the base with sources and marks what it could not verify', async () => {
    const generated = await trip.post('/base/generate');
    assert.equal(generated.status, 201);
    const content = generated.body.stage.content;
    const alfama = content.neighborhoods.find((n: any) => n.name === 'Alfama');
    const baixa = content.neighborhoods.find((n: any) => n.name === 'Baixa');

    assert.equal(alfama.cost.status, 'VERIFIED');
    assert.equal(alfama.cost.amount, 120);
    assert.equal(alfama.cost.sourceUrl, `http://${api!.siteHost}/page-1`);
    assert.ok(alfama.cost.consultedAt);
    assert.deepEqual(alfama.factIds, ['F1', 'F2']); // the invented F99 is dropped
    assert.equal(baixa.cost.status, 'NOT_VERIFIED');
    assert.equal(baixa.cost.amount, null);
    assert.ok(content.couldNotVerify.some((n: string) => n.startsWith('F3 sem fonte')));
    assert.equal(content.facts.find((f: any) => f.category === 'NAO_ENCONTRADO').sources.length, 0);

    assert.equal((await trip.edit('BASE', (c) => (c.neighborhoods = 'x'))).status, 400);
    await trip.approve('BASE');
  });

  it('4. builds the route, grouping attractions and flagging unverified reservations', async () => {
    const generated = await trip.post('/route/generate');
    assert.equal(generated.status, 201);
    const content = generated.body.stage.content;
    const castle = content.attractions.find((a: any) => a.name === 'Castelo de São Jorge');
    const monastery = content.attractions.find((a: any) => a.name === 'Mosteiro dos Jerónimos');

    assert.equal(castle.ticket.status, 'VERIFIED');
    assert.equal(castle.reservation.required, true);
    assert.equal(monastery.ticket.status, 'NOT_VERIFIED');
    assert.equal(monastery.reservation.required, null); // the model said "required" but no source backs it
    assert.deepEqual(content.clusters.map((c: any) => c.name), ['Centro', 'Belém', 'Orfã']);
    await trip.approve('ROUTE');
  });

  it('5. builds the days using the limit from the constraints, then a stricter one', async () => {
    const byConstraints = await trip.post('/days/generate');
    assert.equal(byConstraints.status, 201);
    assert.equal(byConstraints.body.stage.content.limits.maxPrioritiesPerDay, 2);
    assert.equal(byConstraints.body.stage.content.days[0].priorities.length, 2);

    const strict = await trip.post('/days/generate', { regenerate: true, maxPrioritiesPerDay: 1 });
    assert.equal(strict.status, 200);
    const content = strict.body.stage.content;

    assert.deepEqual(content.days.map((d: any) => d.date), ['2026-11-01', '2026-11-02', '2026-11-03']);
    assert.deepEqual(content.days[0].priorities.map((p: any) => p.attraction), ['Castelo de São Jorge']);
    assert.deepEqual(content.days[0].flexibleOptions, ['Mosteiro dos Jerónimos']);
    assert.ok(content.days.every((d: any) => d.priorities.length <= 1));
    assert.equal(content.days[0].travel[0].minutes, 35);
    assert.equal(content.days[1].travel[0].minutes, null); // no sourced fact
    assert.equal(content.days[1].meal.price.status, 'NOT_VERIFIED');
    assert.deepEqual(content.reservations.map((r: any) => [r.attraction, r.status]), [['Castelo de São Jorge', 'REQUIRED'], ['Mosteiro dos Jerónimos', 'UNKNOWN']]);
    assert.equal(content.skipSuggestion.kind, 'ASSESSMENT');
  });

  it('5b. refuses days with a start before the time to avoid, until it is fixed', async () => {
    const submit = await trip.submit('DAYS');
    assert.equal(submit.status, 409);
    assert.match(message(submit), /starts at 06:30, before 09:00/);

    await trip.edit('DAYS', (c) => (c.days[1].priorities[0].start = '09:30'));
    await trip.approve('DAYS');
  });

  it('6. builds the budget counting only verified prices', async () => {
    const generated = await trip.post('/budget/generate');
    assert.equal(generated.status, 201);
    const content = generated.body.stage.content;
    const item = (id: string) => content.items.find((i: any) => i.id === id);

    assert.deepEqual(content.inputs, { currency: 'EUR', total: 3000, days: 3, nights: 2, people: 2, rooms: 1 });
    assert.equal(item('LOD1').subtotal, 240);
    assert.equal(item('ATR1').subtotal, 30);
    assert.equal(item('TRN1').subtotal, 40.8);
    for (const id of ['ATR2', 'MEAL2', 'TRN2']) {
      assert.equal(item(id).counted, false, id);
      assert.equal(item(id).subtotal, null, id);
    }
    assert.equal(content.totals.verifiedTotal, 382.8);
    assert.ok(content.risks.every((r: any) => r.kind !== 'OVER_ALLOCATION'));
  });

  it('6b. needs a decision for every risk and rejects tampering', async () => {
    assert.match(message(await trip.submit('BUDGET')), /TRANSPORT-LOW_COVERAGE has no decision/);

    await trip.edit('BUDGET', (c) => c.risks.forEach((r: any) => (r.decision ??= 'confirmar a tarifa antes de reservar')));
    await trip.edit('BUDGET', (c) => (c.items.find((i: any) => i.id === 'ATR1').unitPrice.sourceUrl = null));
    assert.match(message(await trip.submit('BUDGET')), /counted without a source/);

    await trip.edit('BUDGET', (c) => (c.items.find((i: any) => i.id === 'ATR1').unitPrice.sourceUrl = `http://${api!.siteHost}/page-1`));
    await trip.edit('BUDGET', (c) => (c.totals.verifiedTotal = 1));
    assert.match(message(await trip.submit('BUDGET')), /totals do not match/);

    await trip.edit('BUDGET', (c) => (c.totals.verifiedTotal = 382.8));
    await trip.approve('BUDGET');
  });

  it('7. opens the sources: confirms what it can read and flags the rest', async () => {
    const site = `http://${api!.siteHost}`;
    const generated = await trip.post('/verification/generate', {
      flights: [
        { subject: 'Voo ok', sourceUrl: `${site}/flight-ok`, amount: 250, currency: 'EUR', mustContain: ['TP 123', '10:35'] },
        { subject: 'Voo errado', sourceUrl: `${site}/flight-ok`, mustContain: ['TP 999'] },
        { subject: 'Voo página vazia', sourceUrl: `${site}/empty`, amount: 300, currency: 'EUR' },
        { subject: 'Voo bloqueado', sourceUrl: `${site}/forbidden`, amount: 300, currency: 'EUR' },
        { subject: 'Voo link quebrado', sourceUrl: `${site}/missing`, amount: 300, currency: 'EUR' },
        { subject: 'SSRF porta da API', sourceUrl: 'http://127.0.0.1:1/health', mustContain: ['ok'] },
        { subject: 'SSRF metadata', sourceUrl: 'http://169.254.169.254/latest/meta-data', mustContain: ['ami'] },
        { subject: 'SSRF localhost', sourceUrl: 'http://localhost:1/', mustContain: ['x'] },
      ],
    });
    assert.equal(generated.status, 201);

    const status = (subject: string) => generated.body.stage.content.checks.find((c: any) => c.subject === subject).status;
    assert.equal(status('Hospedagem em Alfama'), 'CONFIRMED');
    assert.equal(status('Ingresso: Castelo de São Jorge'), 'CONFIRMED');
    assert.equal(status('Dia 1: Taberna X'), 'CONFIRMED');
    assert.equal(status('Passe 24h'), 'CONFIRMED');
    assert.equal(status('Horário: Castelo de São Jorge'), 'CONFIRMED');
    assert.equal(status('Horário: Mosteiro dos Jerónimos'), 'NOT_CHECKABLE'); // no source for the hours
    assert.equal(status('Voo ok'), 'CONFIRMED');
    assert.equal(status('Voo errado'), 'NOT_FOUND_ON_PAGE');
    assert.equal(status('Voo página vazia'), 'NOT_CHECKABLE');
    assert.equal(status('Voo bloqueado'), 'NOT_CHECKABLE');
    assert.equal(status('Voo link quebrado'), 'UNREACHABLE');
    for (const ssrf of ['SSRF porta da API', 'SSRF metadata', 'SSRF localhost']) {
      assert.equal(status(ssrf), 'NOT_CHECKABLE', ssrf);
    }
    assert.ok(generated.body.stage.content.checks.find((c: any) => c.subject === 'Voo ok').evidence.includes('250,00 EUR'));
  });

  it('7b. only lets a human close the gaps, with a note, and never edits results by hand', async () => {
    assert.match(message(await trip.patch(`/stages/${(await trip.stage('VERIFICATION')).id}`, { content: {} })), /only through the \/verification endpoints/);
    assert.match(message(await trip.submit('VERIFICATION')), /NOT_CHECKABLE|UNREACHABLE|NOT_FOUND_ON_PAGE/);

    const checks = (await trip.stage('VERIFICATION')).content.checks as any[];
    const auto = checks.find((c) => c.status === 'CONFIRMED');
    assert.equal((await trip.post(`/verification/checks/${checks.find((c) => c.status !== 'CONFIRMED').id}/confirm`, { note: 'x' })).status, 400);
    assert.equal((await trip.post(`/verification/checks/${auto.id}/confirm`, { note: 'eu vi' })).status, 409);

    for (const check of checks.filter((c) => c.status !== 'CONFIRMED')) {
      const confirmed = await trip.post(`/verification/checks/${check.id}/confirm`, { note: 'Abri a fonte oficial e conferi.' });
      assert.equal(confirmed.status, 200, check.subject);
    }

    const rechecked = await trip.post('/verification/recheck');
    const after = rechecked.body.stage.content.checks as any[];
    assert.equal(after.filter((c) => c.status === 'MANUALLY_CONFIRMED').length, checks.filter((c) => c.status !== 'CONFIRMED').length);

    await trip.approve('VERIFICATION');
  });

  it('8. ends with every stage approved and every request carrying the key only in a header', async () => {
    const stages = (await trip.get('/stages')).body.stages as any[];
    const latest = (name: string) => stages.filter((s) => s.stage === name).sort((a, b) => b.version - a.version)[0];

    for (const name of ['INTERVIEW', 'CONSTRAINTS', 'BASE', 'ROUTE', 'DAYS', 'BUDGET', 'VERIFICATION']) {
      assert.equal(latest(name).status, 'APPROVED', name);
    }

    assert.ok(api!.gemini.requests.every((r) => !r.url.includes('key=') && !r.url.includes(FAKE_GOOD_KEY)));
    assert.ok(api!.gemini.requests.some((r) => r.body.tools)); // web search was used
  });
});

describe('verification guards', { skip }, () => {
  it('flags a verification as stale when the plan changes after it', async () => {
    const user = await api!.newUser();
    const trip = await api!.newTrip(user);
    await advanceThroughBudget(trip);

    assert.equal((await trip.post('/verification/generate')).status, 201);
    for (const check of (await trip.stage('VERIFICATION')).content.checks.filter((c: any) => c.status !== 'CONFIRMED')) {
      await trip.post(`/verification/checks/${check.id}/confirm`, { note: 'conferido manualmente' });
    }

    // The budget is regenerated (a new version), so the earlier verification no longer matches it.
    assert.equal((await trip.post('/budget/generate', { people: 3 })).status, 201);
    assert.match(message(await trip.submit('VERIFICATION')), /plan changed/);
  });

  it('warns that no flight was checked, and accepts flights added later', async () => {
    const user = await api!.newUser();
    const trip = await api!.newTrip(user);
    await advanceThroughBudget(trip);

    const generated = await trip.post('/verification/generate');
    assert.match(generated.body.stage.content.warnings.join(' '), /Nenhum voo/);

    const flight = { subject: 'Voo', sourceUrl: `http://${api!.siteHost}/flight-ok`, amount: 250, currency: 'EUR' };
    const added = await trip.post('/verification/flights', { flights: [flight] });
    assert.equal(added.status, 200);
    assert.deepEqual(added.body.stage.content.warnings, []);
    assert.equal(added.body.stage.content.checks.at(-1).status, 'CONFIRMED');

    assert.equal((await trip.post('/verification/flights', { flights: [{ subject: 'sem nada', sourceUrl: flight.sourceUrl }] })).status, 400);
    assert.equal((await trip.post('/verification/flights', { flights: [{ subject: 'x', sourceUrl: 'file:///etc/passwd', mustContain: ['root'] }] })).status, 400);
  });
});
