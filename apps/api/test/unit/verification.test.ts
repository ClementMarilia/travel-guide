import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import {
  flightChecks,
  flightInputSchema,
  planChecks,
  runChecks,
  verificationSubmitProblems,
  withIds,
  type Check,
  type VerificationContent,
} from '../../src/planning/verification.js';
import { budget, route, validDays } from '../helpers/fixtures.js';

describe('planChecks', () => {
  const checks = planChecks(budget(), route(), validDays());
  const by = (subject: string) => checks.find((c) => c.subject === subject)!;

  it('checks every price counted in the budget, by kind, against its own source', () => {
    assert.deepEqual(
      checks.filter((c) => c.kind !== 'SCHEDULE').map((c) => [c.kind, c.subject, c.sourceUrl, c.claim.amount]),
      [
        ['HOTEL', 'Hospedagem em Alfama', 'https://example.com/hotel', 120],
        ['TICKET', 'Ingresso: Castelo de São Jorge', 'https://example.com/castle', 15],
        ['MEAL', 'Dia 1: Taberna X', 'https://example.com/food', 18],
        ['MEAL', 'Dia 3: Taberna X', 'https://example.com/food', 18],
        ['TRANSPORT', 'Passe 24h', 'https://example.com/metro', 6.8],
      ],
    );
  });

  it('does not check prices that were left out of the budget', () => {
    const subjects = checks.map((c) => c.subject);

    assert.ok(!subjects.includes('Ingresso: Mosteiro dos Jerónimos'));
    assert.ok(!subjects.includes('Táxi aeroporto'));
  });

  it('checks the opening hours of every scheduled attraction, using the sourced sentence', () => {
    assert.deepEqual(by('Horário: Castelo de São Jorge').claim.times, ['09:00', '21:00']);
    assert.equal(by('Horário: Castelo de São Jorge').sourceUrl, 'https://example.com/castle');
  });

  it('asks for a manual check when the hours have no source', () => {
    const monastery = by('Horário: Mosteiro dos Jerónimos');

    assert.equal(monastery.sourceUrl, null);
    assert.deepEqual(monastery.claim.times, ['10:00']);
  });

  it('skips the hours of attractions that are not scheduled', () => {
    const none = planChecks(budget(), route(), { ...validDays(), days: validDays().days.map((d) => ({ ...d, priorities: [] })) });

    assert.ok(none.every((c) => c.kind !== 'SCHEDULE'));
  });
});

describe('flight input', () => {
  const ok = { subject: 'Voo', sourceUrl: 'https://example.com/f' };

  it('needs an amount with currency or texts that must appear', () => {
    assert.ok(flightInputSchema.safeParse({ ...ok, amount: 250, currency: 'eur' }).success);
    assert.ok(flightInputSchema.safeParse({ ...ok, mustContain: ['TP 123'] }).success);
    assert.ok(!flightInputSchema.safeParse(ok).success);
    assert.ok(!flightInputSchema.safeParse({ ...ok, amount: 250 }).success);
    assert.ok(!flightInputSchema.safeParse({ ...ok, mustContain: [] }).success);
  });

  it('only accepts http(s) links', () => {
    assert.ok(!flightInputSchema.safeParse({ ...ok, sourceUrl: 'file:///etc/passwd', mustContain: ['x'] }).success);
    assert.ok(!flightInputSchema.safeParse({ ...ok, sourceUrl: 'javascript:alert(1)', mustContain: ['x'] }).success);
  });

  it('becomes a user-origin flight check', () => {
    const [check] = flightChecks([flightInputSchema.parse({ ...ok, amount: 250, currency: 'eur', mustContain: ['TP 123'] })]);

    assert.deepEqual(check, {
      kind: 'FLIGHT',
      subject: 'Voo',
      origin: 'USER',
      sourceUrl: 'https://example.com/f',
      claim: { amount: 250, currency: 'EUR', times: [], mustContain: ['TP 123'] },
    });
  });
});

describe('runChecks', () => {
  let server: http.Server;
  let base: string;
  let hits: Record<string, number>;
  const original = process.env.VERIFY_ALLOW_HOSTS;
  const filler = '<p>Informações gerais sobre a visita, políticas de cancelamento e contatos do local.</p>'.repeat(4);

  const page = (body: string) => `<html><body>${body}${filler}</body></html>`;
  const pages: Record<string, string> = {
    '/hotel': page('<p>Diária média: 120,00 &euro; por noite.</p>'),
    '/castle': page('<p>Ingresso 15 EUR.</p><p>Horário: 9h às 21h.</p>'),
    '/flight': page('<p>Voo TP 123, partida 10:35, tarifa 250,00 EUR.</p>'),
    '/empty': '<html><body><div id="root"></div><script>window.app = 1</script></body></html>',
  };

  const check = (sourceUrl: string | null, claim: Partial<Check['claim']>) => ({
    kind: 'TICKET' as const,
    subject: 's',
    origin: 'PLAN' as const,
    sourceUrl,
    claim: { amount: null, currency: null, times: [], mustContain: [], ...claim },
  });
  const run = async (...checks: ReturnType<typeof check>[]) => (await runChecks(checks)).map((c) => c.status);

  before(async () => {
    hits = {};
    server = http
      .createServer((req, res) => {
        hits[req.url!] = (hits[req.url!] ?? 0) + 1;
        if (req.url === '/forbidden') return void res.writeHead(403).end();
        if (req.url === '/pdf') return void res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF');
        const body = pages[req.url!];
        if (!body) return void res.writeHead(404).end();
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
      })
      .listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.VERIFY_ALLOW_HOSTS = base.replace('http://', '');
  });

  after(() => {
    server.close();
    if (original === undefined) delete process.env.VERIFY_ALLOW_HOSTS;
    else process.env.VERIFY_ALLOW_HOSTS = original;
  });

  it('confirms a price, hours and texts that appear on the page, with the evidence', async () => {
    const [price, hours, flight] = await runChecks([
      check(`${base}/hotel`, { amount: 120, currency: 'EUR' }),
      check(`${base}/castle`, { times: ['09:00', '21:00'] }),
      check(`${base}/flight`, { amount: 250, currency: 'EUR', mustContain: ['TP 123', '10:35'] }),
    ]);

    assert.equal(price!.status, 'CONFIRMED');
    assert.match(price!.evidence ?? '', /120,00 €/);
    assert.equal(hours!.status, 'CONFIRMED');
    assert.equal(flight!.status, 'CONFIRMED');
    assert.equal(price!.httpStatus, 200);
    assert.ok(price!.checkedAt);
  });

  it('does not confirm a value that is not on the page', async () => {
    const [wrongPrice, wrongHour, wrongText] = await runChecks([
      check(`${base}/hotel`, { amount: 99, currency: 'EUR' }),
      check(`${base}/castle`, { times: ['09:00', '22:00'] }),
      check(`${base}/flight`, { mustContain: ['TP 999'] }),
    ]);

    assert.equal(wrongPrice!.status, 'NOT_FOUND_ON_PAGE');
    assert.match(wrongPrice!.reason ?? '', /preço 99 EUR/);
    assert.equal(wrongHour!.status, 'NOT_FOUND_ON_PAGE');
    assert.match(wrongHour!.reason ?? '', /horário 22:00/);
    assert.equal(wrongText!.status, 'NOT_FOUND_ON_PAGE');
    assert.equal(wrongPrice!.evidence, null);
  });

  it('needs every claim on a check to be present', async () => {
    assert.deepEqual(await run(check(`${base}/flight`, { amount: 250, currency: 'EUR', mustContain: ['TP 123', 'TP 999'] })), ['NOT_FOUND_ON_PAGE']);
  });

  it('separates pages it cannot read from pages that are down', async () => {
    assert.deepEqual(
      await run(
        check(`${base}/empty`, { amount: 1, currency: 'EUR' }),
        check(`${base}/forbidden`, { amount: 1, currency: 'EUR' }),
        check(`${base}/pdf`, { amount: 1, currency: 'EUR' }),
        check(`${base}/missing`, { amount: 1, currency: 'EUR' }),
      ),
      ['NOT_CHECKABLE', 'NOT_CHECKABLE', 'NOT_CHECKABLE', 'UNREACHABLE'],
    );
  });

  it('asks for a manual check when there is no link or nothing to compare', async () => {
    assert.deepEqual(await run(check(null, { amount: 1, currency: 'EUR' }), check(`${base}/hotel`, {})), ['NOT_CHECKABLE', 'NOT_CHECKABLE']);
  });

  it('never reaches internal addresses that are not allow-listed', async () => {
    const results = await runChecks([
      check('http://169.254.169.254/latest/meta-data', { mustContain: ['ami'] }),
      check('http://localhost:1/', { mustContain: ['x'] }),
      check('file:///etc/passwd', { mustContain: ['root'] }),
    ]);

    assert.deepEqual(results.map((r) => r.status), ['NOT_CHECKABLE', 'NOT_CHECKABLE', 'NOT_CHECKABLE']);
  });

  it('downloads each URL only once per run', async () => {
    hits = {};
    await run(
      check(`${base}/hotel`, { amount: 120, currency: 'EUR' }),
      check(`${base}/hotel`, { amount: 99, currency: 'EUR' }),
      check(`${base}/hotel`, { mustContain: ['Diária'] }),
    );

    assert.equal(hits['/hotel'], 1);
  });

  it('gives sequential ids', () => {
    assert.deepEqual(withIds([{ ...check('x', {}) } as never, { ...check('y', {}) } as never], 3).map((c) => c.id), ['chk-3', 'chk-4']);
  });
});

describe('verificationSubmitProblems', () => {
  const confirmed: Check = {
    id: 'chk-1', kind: 'HOTEL', subject: 'Hotel', origin: 'PLAN', sourceUrl: 'https://example.com',
    claim: { amount: 1, currency: 'EUR', times: [], mustContain: [] },
    status: 'CONFIRMED', reason: null, evidence: 'visto', httpStatus: 200, finalUrl: 'https://example.com',
    checkedAt: '2026-10-12T00:00:00.000Z', manualNote: null, confirmedAt: null,
  };
  const content = (...checks: Check[]): VerificationContent => ({ checks, warnings: [], source: { budgetStageId: 'b', budgetVersion: 1 } });

  it('accepts when everything is confirmed, automatically or by hand', () => {
    const manual: Check = { ...confirmed, id: 'chk-2', status: 'MANUALLY_CONFIRMED', evidence: null, manualNote: 'vi no site', confirmedAt: 'x' };

    assert.deepEqual(verificationSubmitProblems(content(confirmed, manual)), []);
  });

  it('refuses anything that is not confirmed', () => {
    for (const status of ['NOT_FOUND_ON_PAGE', 'NOT_CHECKABLE', 'UNREACHABLE'] as const) {
      const problems = verificationSubmitProblems(content(confirmed, { ...confirmed, id: 'chk-2', status, evidence: null, reason: 'motivo' }));

      assert.match(problems.join(' '), new RegExp(status));
    }
  });

  it('refuses a confirmation that has no evidence, or a manual one with no note', () => {
    assert.match(verificationSubmitProblems(content({ ...confirmed, evidence: null })).join(' '), /without evidence/);
    assert.match(
      verificationSubmitProblems(content({ ...confirmed, status: 'MANUALLY_CONFIRMED', manualNote: null })).join(' '),
      /needs a note/,
    );
  });

  it('refuses an empty verification', () => {
    assert.match(verificationSubmitProblems(content()).join(' '), /nothing to verify/);
  });
});
