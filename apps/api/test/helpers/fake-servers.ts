/* eslint-disable @typescript-eslint/no-explicit-any */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type Fake = { origin: string; host: string; close: () => Promise<void> };

function listen(server: http.Server): Promise<Fake> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        host: `127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
      });
    });
  });
}

const filler = '<p>Informações gerais sobre a visita, políticas de cancelamento, acessibilidade e contatos do local.</p>'.repeat(3);

// Pages the verification stage can open. page-1 and page-2 are what the fake search "found".
export function startFakeSite(): Promise<Fake> {
  const pages: Record<string, string> = {
    '/page-1': `<html><body><h1>Lisboa</h1><p>Diária média em Alfama: 120,00 &euro; por noite.</p><p>Ingresso adulto: 15 EUR.</p><p>Passe 24h: 6,80 € por dia.</p><p>Horário: 9h às 21h todos os dias.</p>${filler}</body></html>`,
    '/page-2': `<html><body><h1>Taberna X</h1><p>Pratos do dia a 18 EUR.</p>${filler}</body></html>`,
    '/flight-ok': `<html><body><h1>Voo TP 123</h1><p>Partida 10:35 de Lisboa. Tarifa: 250,00 EUR.</p>${filler}</body></html>`,
    '/empty': '<html><body><div id="root"></div><script>window.app=1</script></body></html>',
  };

  return listen(
    http.createServer((req, res) => {
      if (req.url === '/forbidden') return void res.writeHead(403).end('no');
      const page = pages[req.url ?? ''];
      if (!page) return void res.writeHead(404).end('nope');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
    }),
  );
}

export const FAKE_GOOD_KEY = 'GOODKEY0000';
export const FAKE_BAD_KEY = 'BADKEY00000';

export type FakeGemini = Fake & { requests: { url: string; key: string | undefined; body: any }[] };

// Imitates the parts of the Gemini API the app uses: model lookup, plain and JSON generation, and
// search with grounding (sources whose links are redirects that lead to the fake site).
export async function startFakeGemini(siteOrigin: string): Promise<FakeGemini> {
  const requests: FakeGemini['requests'] = [];
  let questions = 0;

  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/redirect/')) {
      return void res.writeHead(302, { location: `${siteOrigin}/page-${req.url.split('/')[2]}` }).end();
    }

    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const key = req.headers['x-goog-api-key'] as string | undefined;
      if (key === FAKE_BAD_KEY) return void res.writeHead(403).end('{}');

      if (req.method === 'GET') return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"name":"models/fake"}');

      const body = JSON.parse(raw || '{}');
      requests.push({ url: req.url ?? '', key, body });
      const system: string = body.systemInstruction?.parts?.[0]?.text ?? '';
      const reply = (text: string, extra: Record<string, unknown> = {}) =>
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...extra }] }));

      const chunks = (a: string, b: string) => [
        { web: { uri: `${origin}/redirect/1`, title: a } },
        { web: { uri: `${origin}/redirect/2`, title: b } },
      ];
      const search = (lines: string[], supported: Record<number, number>) => {
        let offset = 0;
        const spans = lines.map((line) => {
          const start = offset;
          offset += Buffer.byteLength(line) + 1;
          return [start, start + Buffer.byteLength(line)] as const;
        });

        return reply(lines.join('\n'), {
          groundingMetadata: {
            webSearchQueries: ['consulta'],
            groundingChunks: chunks('a.com', 'b.com'),
            groundingSupports: Object.entries(supported).map(([line, chunk]) => ({
              segment: { startIndex: spans[Number(line)]![0], endIndex: spans[Number(line)]![1] },
              groundingChunkIndices: [chunk],
            })),
          },
        });
      };

      // ---- searches (tools present) ----
      if (body.tools && system.includes('preços de transporte local')) {
        return search(['FATO [CUSTO] Passe 24h metrô: 6.80 EUR por pessoa por dia', 'FATO [CUSTO] Táxi aeroporto-centro: cerca de 20 EUR por corrida'], { 0: 0 });
      }
      if (body.tools && system.includes('montar os dias')) {
        return search(
          [
            'FATO [DESLOCAMENTO] Castelo para Mosteiro: 35 min de transporte público',
            'FATO [ALIMENTACAO] Taberna X perto do Castelo: pratos a 18 EUR',
            'FATO [ALIMENTACAO] Cantina Y perto de Belém: pratos a 20 EUR',
            'FATO [FILA] Mosteiro dos Jerónimos: fila longa em alta temporada',
            'FATO [CHUVA] Museu Z: atração coberta no centro',
          ],
          { 0: 0, 1: 1, 3: 0, 4: 1 },
        );
      }
      if (body.tools && system.includes('montar uma rota')) {
        return search(
          [
            'FATO [DESLOCAMENTO] Castelo de São Jorge: 20 min a pé desde Alfama',
            'FATO [HORARIO] Castelo de São Jorge: abre às 9h e fecha às 21h',
            'FATO [RESERVA] Castelo de São Jorge: recomenda-se comprar o ingresso online',
            'FATO [CUSTO] Castelo de São Jorge: ingresso 15 EUR',
            'FATO [HORARIO] Mosteiro dos Jerónimos: abre às 10h',
            'FATO [CUSTO] Mosteiro dos Jerónimos: ingresso 12 EUR',
            'FATO [RESERVA] Mosteiro dos Jerónimos: reserva obrigatória',
            'FATO [NAO_ENCONTRADO] Torre de Belém: horário',
          ],
          { 0: 1, 1: 0, 2: 0, 3: 0, 7: 0 },
        );
      }
      if (body.tools) {
        return search(
          [
            'Pesquisa concluída:',
            'FATO [CUSTO] Alfama: diária média de 120 EUR em hotéis 3 estrelas',
            'FATO [DESLOCAMENTO] Alfama: 15 min de metrô até o Bairro Alto',
            'FATO [CUSTO] Baixa: diária média de 90 EUR',
            'FATO [NAO_ENCONTRADO] Baixa: horário de fechamento do Castelo',
            'FATO [HORARIO] Alfama: Castelo abre 9h às 18h, fecha em feriados',
          ],
          { 1: 0, 2: 1, 4: 0, 5: 1 },
        );
      }

      // ---- structured / plain generation ----
      if (system.includes('riscos de estouro')) {
        const ids: string[] = [];
        for (const c of ['LODGING', 'FOOD', 'TRANSPORT', 'ATTRACTIONS']) {
          for (const k of ['OVER_ALLOCATION', 'NEAR_LIMIT', 'LOW_COVERAGE', 'PARTIAL_SCOPE']) ids.push(`${c}-${k}`);
        }
        // TRANSPORT-LOW_COVERAGE is left without a decision on purpose.
        return reply(JSON.stringify({ decisions: ids.filter((id) => id !== 'TRANSPORT-LOW_COVERAGE').map((riskId) => ({ riskId, decision: `Decisão para ${riskId}` })) }));
      }
      if (system.includes('orçamento estruturado')) {
        return reply(
          JSON.stringify({
            units: [
              { itemId: 'LOD1', unit: 'PER_NIGHT' },
              { itemId: 'ATR1', unit: 'PER_PERSON' },
              { itemId: 'ATR2', unit: 'PER_PERSON' },
              { itemId: 'MEAL1', unit: 'PER_PERSON' },
              { itemId: 'MEAL2', unit: 'PER_PERSON' },
              { itemId: 'MEAL3', unit: 'PER_PERSON' },
            ],
            transport: [
              { label: 'Passe 24h', unit: 'PER_PERSON_PER_DAY', cost: { text: '6.80 EUR', amount: 6.8, currency: 'EUR', factIds: ['F1'] } },
              { label: 'Táxi aeroporto', unit: 'TOTAL', cost: { text: '20 EUR', amount: 20, currency: 'EUR', factIds: ['F2'] } },
            ],
            allocation: { LODGING: 45, FOOD: 20, ATTRACTIONS: 10, TRANSPORT: 10, CONTINGENCY: 15 },
            allocationReasoning: 'Hospedagem pesa mais.',
            couldNotVerify: [],
          }),
        );
      }
      if (system.includes('dias de uma viagem, estruturados')) {
        const meal = (name: string, amount: number, factId: string) => ({ name, near: 'rota do dia', notes: '', price: { text: `${amount} EUR`, amount, currency: 'EUR', factIds: [factId] }, factIds: [factId] });
        const rain = { text: 'Museu Z coberto', factIds: ['F5'] };
        const prio = (attraction: string, start: string, slot = 'MORNING') => ({ attraction, slot, start, durationMinutes: 60 });

        return reply(
          JSON.stringify({
            days: [
              { day: 1, theme: 'Centro', cluster: 'Centro', priorities: [prio('Castelo de São Jorge', '09:30'), prio('Mosteiro dos Jerónimos', '14:00', 'AFTERNOON')], flexibleOptions: [], afternoonNote: 'livre', travel: [{ from: 'Castelo', to: 'Mosteiro', minutes: 35, mode: 'transporte', factIds: ['F1'] }], meal: meal('Taberna X', 18, 'F2'), rainPlan: rain },
              { day: 2, theme: 'Belém', cluster: 'Belém', priorities: [prio('Mosteiro dos Jerónimos', '06:30'), prio('Atração Fantasma', '10:00')], flexibleOptions: ['Torre de Belém'], afternoonNote: 'livre', travel: [{ from: 'Mosteiro', to: 'Torre', minutes: 20, mode: 'a pé', factIds: [] }], meal: meal('Cantina Y', 20, 'F3'), rainPlan: rain },
              { day: 3, theme: 'Livre', cluster: 'Centro', priorities: [prio('Castelo de São Jorge', '10:00')], flexibleOptions: [], afternoonNote: 'livre', travel: [], meal: meal('Taberna X', 18, 'F2'), rainPlan: rain },
            ],
            unscheduled: [],
            skipSuggestion: { attraction: 'Mosteiro dos Jerónimos', criterion: 'QUEUE', reasoning: 'o critério fila indica espera longa em alta temporada', factIds: ['F4'] },
            couldNotVerify: [],
          }),
        );
      }
      if (system.includes('rota de atrações estruturada')) {
        const att = (name: string, cluster: string, priority: string, hours: string[], reservation: string[], ticket: string[], amount: number | null, minutes: number | null, factIds: string[]) => ({
          name, cluster, priority, minutesFromBase: minutes, travelMode: 'a pé', durationMinutes: 90,
          hours: { text: 'horário', factIds: hours }, reservation: { required: true, text: 'reserva', factIds: reservation },
          ticket: { text: 'ingresso', amount, currency: amount === null ? null : 'EUR', factIds: ticket }, alerts: [], factIds,
        });

        return reply(
          JSON.stringify({
            clusters: [{ name: 'Centro', order: 1, rationale: 'perto da base' }, { name: 'Belém', order: 2, rationale: 'um dia à parte' }],
            attractions: [
              att('Castelo de São Jorge', 'Centro', 'MUST', ['F2'], ['F3'], ['F4'], 15, 20, ['F1', 'F2']),
              att('Mosteiro dos Jerónimos', 'Belém', 'MUST', ['F5'], ['F7'], ['F6'], 12, null, ['F5']),
              att('Torre de Belém', 'Orfã', 'NICE', ['F8'], [], [], null, null, ['F8']),
            ],
            couldNotVerify: ['Horário da Torre de Belém'],
          }),
        );
      }
      if (system.includes('bases de hospedagem estruturadas')) {
        return reply(
          JSON.stringify({
            regions: [{ name: 'Centro histórico', places: ['Castelo'] }],
            neighborhoods: [
              { name: 'Alfama', commuteSummary: '15 min de metrô', access: 'metrô', paceFit: 'bom', cost: { text: '120 EUR/diária', amount: 120, currency: 'EUR', factIds: ['F1'] }, factIds: ['F1', 'F2', 'F99'] },
              { name: 'Baixa', commuteSummary: 'n/d', access: 'metrô', paceFit: 'médio', cost: { text: '90 EUR/diária', amount: 90, currency: 'EUR', factIds: ['F3'] }, factIds: ['F3'] },
            ],
            recommendation: { neighborhood: 'Alfama', reasoning: 'menos deslocamento' },
            discarded: [{ neighborhood: 'Baixa', reason: 'sem fonte para horários' }],
            couldNotVerify: ['Fechamento do Castelo'],
          }),
        );
      }
      if (system.includes('restrições estruturadas')) {
        return reply(
          JSON.stringify({
            budget: { total: 3000, currency: 'EUR', notes: '' },
            pace: { maxPrioritiesPerDay: 2, freeAfternoons: true, notes: 'tranquilo' },
            food: { restrictions: [], notes: '' },
            mobility: { notes: 'caminham bem' },
            avoidTimes: [{ description: 'acordar cedo', notBefore: '09:00', notAfter: null }],
          }),
        );
      }
      if (body.generationConfig?.responseMimeType === 'application/json') {
        return reply(JSON.stringify({ summary: 'Resumo organizado.', conflicts: [{ description: 'Orçamento baixo vs. uma refeição boa por dia', involves: ['Eu', 'FOOD'] }] }));
      }

      return reply(`Pergunta ${++questions}?`);
    });
  });

  const fake = await listen(server);
  const origin = fake.origin;

  return { ...fake, requests };
}
