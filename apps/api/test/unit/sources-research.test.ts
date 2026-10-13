import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { resolveSourceUrl } from '../../src/ai/sources.js';
import { extractFacts, factLines, hasSource, knownFactIds, verifyCost } from '../../src/planning/research.js';
import { fact } from '../helpers/fixtures.js';

describe('resolveSourceUrl', () => {
  let server: http.Server;
  let host: string;
  const original = process.env.GROUNDING_REDIRECT_HOST;

  before(async () => {
    server = http
      .createServer((req, res) => {
        if (req.url === '/to-page') return void res.writeHead(302, { location: 'https://example.com/page' }).end();
        if (req.url === '/to-itself') return void res.writeHead(302, { location: `http://${host}/to-page` }).end();
        if (req.url === '/to-js') return void res.writeHead(302, { location: 'javascript:alert(1)' }).end();
        if (req.url === '/no-location') return void res.writeHead(200).end('ok');
        res.writeHead(404).end();
      })
      .listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.GROUNDING_REDIRECT_HOST = host;
  });

  after(() => {
    server.close();
    if (original === undefined) delete process.env.GROUNDING_REDIRECT_HOST;
    else process.env.GROUNDING_REDIRECT_HOST = original;
  });

  it('keeps a normal link as is and marks it direct', async () => {
    assert.deepEqual(await resolveSourceUrl('https://example.com/a?b=1'), { url: 'https://example.com/a?b=1', direct: true });
  });

  it('resolves a redirect link to the page it points to', async () => {
    assert.deepEqual(await resolveSourceUrl(`http://${host}/to-page`), { url: 'https://example.com/page', direct: true });
  });

  it('does not mark a redirect as direct when it cannot be resolved', async () => {
    for (const path of ['/no-location', '/to-itself', '/to-js', '/missing']) {
      const result = await resolveSourceUrl(`http://${host}${path}`);
      assert.equal(result.direct, false, path);
    }
  });

  it('refuses links that are not http(s) or not URLs', async () => {
    assert.equal((await resolveSourceUrl('javascript:alert(1)')).direct, false);
    assert.equal((await resolveSourceUrl('ftp://example.com/x')).direct, false);
    assert.equal((await resolveSourceUrl('nonsense')).direct, false);
  });
});

describe('extractFacts', () => {
  const now = new Date('2026-10-12T10:00:00Z');
  const chunks = [
    { uri: 'https://a.example.com/p', title: 'a.example.com' },
    { uri: 'https://b.example.com/p', title: 'b.example.com' },
  ];

  // Builds the response text plus supports using UTF-8 byte offsets, like the real API.
  function grounded(lines: string[], supportsByLine: Record<number, number[]>) {
    let offset = 0;
    const spans = lines.map((line) => {
      const start = offset;
      offset += Buffer.byteLength(line) + 1;
      return { start, end: start + Buffer.byteLength(line) };
    });

    return {
      text: lines.join('\n'),
      grounding: {
        queries: ['q'],
        chunks,
        supports: Object.entries(supportsByLine).map(([line, chunkIndices]) => ({ ...spans[Number(line)]!, chunkIndices })),
      },
    };
  }

  it('ties each fact to the sources of its own line, even with accents', async () => {
    const lines = [
      'Pesquisa concluída:',
      'FATO [CUSTO] Alfama: diária média de 120 EUR em hotéis três estrelas',
      'FATO [DESLOCAMENTO] Alfama: 15 min de metrô até o Bairro Alto — ótimo',
      'FATO [CUSTO] Baixa: diária média de 90 EUR',
    ];
    const { text, grounding } = grounded(lines, { 1: [0], 2: [1] });
    const facts = await extractFacts(text, grounding, now);

    assert.equal(facts.length, 3);
    assert.deepEqual(facts.map((f) => f.id), ['F1', 'F2', 'F3']);
    assert.deepEqual(facts[0]!.sources.map((s) => s.url), ['https://a.example.com/p']);
    assert.deepEqual(facts[1]!.sources.map((s) => s.url), ['https://b.example.com/p']);
    assert.deepEqual(facts[2]!.sources, []);
    assert.equal(facts[0]!.sources[0]!.consultedAt, now.toISOString());
  });

  it('never gives a source to a "not found" fact', async () => {
    const { text, grounding } = grounded(['FATO [NAO_ENCONTRADO] Baixa: horário do castelo'], { 0: [0] });
    const [only] = await extractFacts(text, grounding, now);

    assert.equal(only!.category, 'NAO_ENCONTRADO');
    assert.deepEqual(only!.sources, []);
  });

  it('merges several sources for one line without duplicates', async () => {
    const { text, grounding } = grounded(['FATO [CUSTO] Alfama: 120 EUR'], { 0: [0, 1, 0] });
    const [only] = await extractFacts(text, grounding, now);

    assert.equal(only!.sources.length, 2);
  });

  it('ignores lines that are not facts or have an unknown category', async () => {
    const facts = await extractFacts('Olá\nFATO [INVENTADA] x: y\nfato sem formato\nFATO [CUSTO] A: 1 EUR', undefined, now);

    assert.equal(facts.length, 1);
    assert.equal(facts[0]!.text, 'A: 1 EUR');
    assert.deepEqual(facts[0]!.sources, []);
  });

  it('produces no sources when the search returned no grounding', async () => {
    const facts = await extractFacts('FATO [CUSTO] A: 1 EUR', undefined, now);
    assert.deepEqual(facts[0]!.sources, []);
  });
});

describe('fact helpers', () => {
  const sourced = fact('F1', 'CUSTO', 'A: 15 EUR', ['https://example.com/a']);
  const unsourced = fact('F2', 'CUSTO', 'B: 20 EUR');
  const byId = new Map([sourced, unsourced].map((f) => [f.id, f]));

  it('drops ids that do not exist and removes duplicates', () => {
    assert.deepEqual(knownFactIds(['F1', 'F1', 'F99', 'F2'], byId), ['F1', 'F2']);
  });

  it('counts a source only for ids that exist', () => {
    assert.equal(hasSource(['F1'], byId), true);
    assert.equal(hasSource(['F2'], byId), false);
    assert.equal(hasSource(['F99'], byId), false);
    assert.equal(hasSource([], byId), false);
  });

  it('labels facts without a source for the model', () => {
    assert.match(factLines([sourced, unsourced]), /F1 \[CUSTO\] \(com fonte\)/);
    assert.match(factLines([sourced, unsourced]), /F2 \[CUSTO\] \(SEM FONTE\)/);
  });
});

describe('verifyCost', () => {
  const sourced = fact('F1', 'CUSTO', 'A: 15 EUR', ['https://example.com/a']);
  const unsourced = fact('F2', 'CUSTO', 'B: 20 EUR');
  const byId = new Map([sourced, unsourced].map((f) => [f.id, f]));
  const cost = (over = {}) => ({ text: 'x', amount: 15, currency: 'EUR', factIds: ['F1'], ...over });

  it('verifies a price backed by a sourced fact', () => {
    const verified = verifyCost(cost(), byId);

    assert.equal(verified.status, 'VERIFIED');
    assert.equal(verified.amount, 15);
    assert.equal(verified.sourceUrl, 'https://example.com/a');
    assert.equal(verified.consultedAt, '2026-10-12T10:00:00.000Z');
  });

  it('drops the amount when the fact has no source', () => {
    const result = verifyCost(cost({ amount: 20, factIds: ['F2'] }), byId);

    assert.equal(result.status, 'NOT_VERIFIED');
    assert.equal(result.amount, null);
    assert.equal(result.sourceUrl, null);
  });

  it('drops the amount when the model cites no fact, a fake fact, or omits the currency', () => {
    assert.equal(verifyCost(cost({ factIds: [] }), byId).status, 'NOT_VERIFIED');
    assert.equal(verifyCost(cost({ factIds: ['F99'] }), byId).status, 'NOT_VERIFIED');
    assert.equal(verifyCost(cost({ currency: null }), byId).status, 'NOT_VERIFIED');
    assert.equal(verifyCost(cost({ amount: null }), byId).status, 'NOT_VERIFIED');
  });

  it('does not accept a source that was not resolved to the page itself', () => {
    const redirected = { ...sourced, sources: [{ ...sourced.sources[0]!, direct: false }] };
    const result = verifyCost(cost(), new Map([['F1', redirected]]));

    assert.equal(result.status, 'NOT_VERIFIED');
  });
});
