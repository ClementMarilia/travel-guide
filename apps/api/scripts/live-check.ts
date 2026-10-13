/* eslint-disable @typescript-eslint/no-explicit-any */
// Runs the whole planning flow against the real Gemini API and prints what matters for judging it:
// do the search sources resolve to real pages, does the model follow the fact format, are the units
// and prices sensible. Nothing is mocked unless --fake is passed (then local fakes are used, which
// only validates this script).
//
//   GEMINI_API_KEY=... DATABASE_URL=... npx tsx scripts/live-check.ts [--destination "Lisboa"] [--model gemini-2.5-flash]
//                                                                    [--days 4] [--confirm-manually] [--fake]
import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};

const fake = flag('fake');
const destination = option('destination', 'Lisboa');
const model = option('model', 'gemini-2.5-flash');
const tripDays = Number(option('days', fake ? '3' : '4'));
let apiKey = process.env.GEMINI_API_KEY ?? '';

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to a disposable database with the migrations applied.');
  process.exit(2);
}

const stopAll: (() => Promise<void>)[] = [];

if (fake) {
  const { startFakeGemini, startFakeSite, FAKE_GOOD_KEY } = await import('../test/helpers/fake-servers.js');
  const site = await startFakeSite();
  const gemini = await startFakeGemini(site.origin);
  apiKey = FAKE_GOOD_KEY;
  process.env.GEMINI_BASE_URL = gemini.origin;
  process.env.GROUNDING_REDIRECT_HOST = gemini.host;
  process.env.VERIFY_ALLOW_HOSTS = site.host;
  stopAll.push(gemini.close, site.close);
} else if (!apiKey) {
  console.error('Set GEMINI_API_KEY (create one in Google AI Studio). It is only read from the environment.');
  process.exit(2);
}

process.env.JWT_SECRET ??= randomBytes(16).toString('hex');
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

// ---- count calls to Gemini (never logging bodies or keys) -------------------------------------

const calls: { kind: string; status: number; ms: number }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  const started = Date.now();
  const response = await realFetch(input, init);

  if (url.includes(':generateContent')) {
    const sentTools = typeof init?.body === 'string' && init.body.includes('"google_search"');
    calls.push({ kind: sentTools ? 'search' : 'generate', status: response.status, ms: Date.now() - started });
  }
  return response;
}) as typeof fetch;

const redact = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return apiKey ? text.split(apiKey).join('[REDACTED]') : text;
};

const { app } = await import('../src/app.js');
const { getPrisma } = await import('../src/lib/prisma.js');
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let token = '';
async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const out = (line = '') => console.log(redact(line));
const section = (title: string) => out(`\n=== ${title} ${'='.repeat(Math.max(0, 70 - title.length))}`);

let failed = false;
async function finish(code: number) {
  section('Chamadas ao Gemini');
  const by = (kind: string) => calls.filter((c) => c.kind === kind);
  out(`generate: ${by('generate').length} | search: ${by('search').length} | falhas: ${calls.filter((c) => c.status >= 400).length}`);
  out(`status das chamadas: ${[...new Set(calls.map((c) => c.status))].join(', ') || '-'} | tempo total: ${(calls.reduce((s, c) => s + c.ms, 0) / 1000).toFixed(1)}s`);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const stop of stopAll) await stop();
  await getPrisma().$disconnect();
  process.exit(code);
}

async function must(label: string, response: { status: number; body: any }, ok = [200, 201]) {
  if (ok.includes(response.status)) return response.body;
  failed = true;
  out(`\nFALHOU em "${label}": HTTP ${response.status}`);
  out(response.body);
  await finish(1);
  return null;
}

async function stage(trip: string, name: string) {
  const { body } = await call('GET', `/trips/${trip}/stages`);
  return (body.stages as any[]).filter((s) => s.stage === name).sort((a, b) => b.version - a.version)[0];
}

async function approve(trip: string, name: string) {
  const current = await stage(trip, name);
  await must(`enviar ${name} para aprovação`, await call('POST', `/trips/${trip}/stages/${current.id}/submit`));
  await must(`aprovar ${name}`, await call('POST', `/trips/${trip}/stages/${current.id}/approve`));
  out(`-> ${name} aprovada`);
}

async function edit(trip: string, name: string, change: (content: any) => void) {
  const current = await stage(trip, name);
  const content = structuredClone(current.content);
  change(content);
  await must(`editar ${name}`, await call('PATCH', `/trips/${trip}/stages/${current.id}`, { content }));
}

const sources = (facts: any[]) => {
  const all = facts.flatMap((f) => f.sources);
  return { facts: facts.length, withSource: facts.filter((f) => f.sources.length > 0).length, links: all.length, direct: all.filter((s) => s.direct).length };
};

// ---- the flow -------------------------------------------------------------------------------

section('Preparação');
const email = `${randomUUID()}@live-check.local`;
token = (await must('registrar', await call('POST', '/auth/register', { email, password: 'live-check-password' }))).token;
await must('salvar a chave', await call('PUT', '/ai/settings', { apiKey, model }));
const connection = await call('POST', '/ai/settings/test');
out(`Teste de conexão: HTTP ${connection.status} ${JSON.stringify(connection.body)}`);
if (connection.status !== 200) await must('conexão com o Gemini', connection);

const dayMs = 86_400_000;
const start = new Date(Date.now() + 60 * dayMs);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const trip = (
  await must(
    'criar viagem',
    await call('POST', '/trips', { title: `Live check ${destination}`, destination, startDate: iso(start), endDate: iso(new Date(start.getTime() + (tripDays - 1) * dayMs)), currency: 'EUR' }),
  )
).trip.id as string;
const t = (path: string) => `/trips/${trip}${path}`;
await call('POST', t('/travelers'), { name: 'Ele', nonNegotiable: 'nenhum passeio começando às 7h' });
await call('POST', t('/travelers'), { name: 'Eu', nonNegotiable: 'uma refeição boa por dia' });
out(`Viagem: ${destination}, ${iso(start)} a ${iso(new Date(start.getTime() + (tripDays - 1) * dayMs))} (${tripDays} dias), modelo ${model}`);

section('1. Entrevista');
let step = await must('primeira pergunta', await call('POST', t('/interview/answer')));
const answers = ['Cerca de 3000 euros no total, para duas pessoas.', 'Ritmo tranquilo, no máximo dois passeios por dia e tardes livres.', 'Sem restrições, gostamos de comida local.', 'Caminhamos bem, mas preferimos metrô a táxi.', 'Evitar acordar antes das 9h e voltar depois da meia-noite.'];
for (const answer of answers) {
  out(`P${step.question.number}: ${step.question.text}`);
  step = await must('responder', await call('POST', t('/interview/answer'), { answer }));
}
out(`Resumo: ${step.summary}`);
out(`Conflitos apontados: ${JSON.stringify(step.conflicts)}`);
await approve(trip, 'INTERVIEW');

section('2. Restrições');
const constraints = (await must('restrições', await call('POST', t('/constraints/generate')))).stage.content;
out(JSON.stringify({ budget: constraints.budget, pace: constraints.pace, avoidTimes: constraints.avoidTimes, food: constraints.food }, null, 2));
out(`Conflitos a resolver: ${constraints.conflicts.length}`);
await edit(trip, 'CONSTRAINTS', (c) => c.conflicts.forEach((x: any) => (x.resolution ??= '(preenchido pelo live-check)')));
await approve(trip, 'CONSTRAINTS');

section('3. Base (busca com fontes)');
const baseStage = (await must('base', await call('POST', t('/base/generate')))).stage.content;
out(`Fatos/fontes: ${JSON.stringify(sources(baseStage.facts))}`);
out(`Consultas feitas: ${JSON.stringify(baseStage.searchQueries)}`);
for (const f of baseStage.facts.slice(0, 12)) out(`  ${f.id} [${f.category}] fontes=${f.sources.length} direto=${f.sources.filter((s: any) => s.direct).length} :: ${f.text.slice(0, 90)}`);
for (const n of baseStage.neighborhoods) out(`  Bairro ${n.name}: verificado=${n.verified} custo=${n.cost.status} ${n.cost.amount ?? '-'} ${n.cost.currency ?? ''} ${n.cost.sourceUrl ?? ''}`);
out(`Recomendada: ${baseStage.recommendation.neighborhood}`);
out(`Não verificado: ${baseStage.couldNotVerify.length} itens`);
await approve(trip, 'BASE');

section('4. Rota');
const route = (await must('rota', await call('POST', t('/route/generate')))).stage.content;
out(`Fatos/fontes: ${JSON.stringify(sources(route.facts))}`);
for (const a of route.attractions) {
  out(`  ${a.name} [${a.cluster}/${a.priority}] horas=${a.hours.verified} tempos=${a.timesVerified} reserva=${a.reservation.required}/${a.reservation.verified} ingresso=${a.ticket.status} ${a.ticket.amount ?? '-'}`);
}
await approve(trip, 'ROUTE');

section('5. Dias');
const daysStage = (await must('dias', await call('POST', t('/days/generate')))).stage.content;
out(`Limites: ${JSON.stringify(daysStage.limits)}`);
for (const d of daysStage.days) {
  out(`  Dia ${d.day} ${d.date}: ${d.priorities.map((p: any) => `${p.attraction} ${p.start}`).join(' | ') || '(livre)'} || comer: ${d.meal.name} (${d.meal.price.status}) || chuva verificada=${d.rainPlan.verified}`);
}
out(`Avisos do servidor: ${JSON.stringify(daysStage.warnings)}`);
out(`Atração a repensar: ${JSON.stringify(daysStage.skipSuggestion)}`);
const submitDays = await call('POST', t(`/stages/${(await stage(trip, 'DAYS')).id}/submit`));
if (submitDays.status !== 200) {
  out(`\nO envio dos dias foi recusado (isso é um resultado da rodada): ${JSON.stringify(submitDays.body)}`);
  await finish(1);
}
await call('POST', t(`/stages/${(await stage(trip, 'DAYS')).id}/approve`));
out('-> DAYS aprovada');

section('6. Orçamento');
const budget = (await must('orçamento', await call('POST', t('/budget/generate')))).stage.content;
out(`Entradas: ${JSON.stringify(budget.inputs)}`);
for (const i of budget.items) out(`  ${i.id} ${i.category} "${i.label}" unidade=${i.unit} contado=${i.counted} subtotal=${i.subtotal ?? '-'} ${i.formula ?? i.excludedReason}`);
out(`Totais: ${JSON.stringify(budget.totals)} | alocação: ${budget.categories.map((c: any) => `${c.category} ${c.percent}%`).join(', ')}`);
out(`Riscos: ${budget.risks.map((r: any) => `${r.id}(${r.severity}${r.decision ? '' : ', sem decisão'})`).join(', ')}`);
await edit(trip, 'BUDGET', (c) => c.risks.forEach((r: any) => (r.decision ??= '(preenchido pelo live-check)')));
await approve(trip, 'BUDGET');

section('7. Verificação (páginas reais)');
const verification = (await must('verificação', await call('POST', t('/verification/generate')))).stage.content;
const tally: Record<string, number> = {};
for (const c of verification.checks) tally[c.status] = (tally[c.status] ?? 0) + 1;
out(`Resultado: ${JSON.stringify(tally)}`);
for (const c of verification.checks) out(`  ${c.status.padEnd(18)} ${c.kind.padEnd(9)} ${c.subject.slice(0, 40).padEnd(40)} ${c.sourceUrl ?? '(sem link)'}  ${c.reason ?? ''}`.trimEnd());

const unresolved = verification.checks.filter((c: any) => c.status !== 'CONFIRMED');
if (unresolved.length > 0 && !flag('confirm-manually')) {
  out(`\n${unresolved.length} item(ns) não foram confirmados automaticamente. Isso é um resultado da rodada; use --confirm-manually para seguir.`);
  await finish(0);
}
for (const c of unresolved) {
  await call('POST', t(`/verification/checks/${c.id}/confirm`), { note: '(live-check: confirmação manual simulada, NÃO verificada)' });
}
await approve(trip, 'VERIFICATION');

out('\nFluxo completo concluído.');
await finish(failed ? 1 : 0);
