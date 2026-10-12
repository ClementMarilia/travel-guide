import { z } from 'zod';
import { fetchPage, type PageResult } from '../lib/page-fetch.js';
import type { BudgetContent } from './budget.js';
import type { DaysContent } from './days.js';
import type { RouteContent } from './route.js';
import { extractTimes, findPrice, findText, findTime, formatTime, pageText } from './verify-match.js';

export const CHECK_KINDS = ['FLIGHT', 'HOTEL', 'TICKET', 'SCHEDULE', 'MEAL', 'TRANSPORT'] as const;
export const CHECK_STATUSES = ['CONFIRMED', 'NOT_FOUND_ON_PAGE', 'NOT_CHECKABLE', 'UNREACHABLE', 'MANUALLY_CONFIRMED'] as const;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const checkSchema = z.object({
  id: z.string(),
  kind: z.enum(CHECK_KINDS),
  subject: z.string(),
  origin: z.enum(['PLAN', 'USER']),
  sourceUrl: z.string().nullable(),
  // What the plan says the page must show.
  claim: z.object({
    amount: z.number().nullable(),
    currency: z.string().nullable(),
    times: z.array(time),
    mustContain: z.array(z.string()),
  }),
  status: z.enum(CHECK_STATUSES),
  reason: z.string().nullable(),
  // The text found on the page that backs a CONFIRMED check.
  evidence: z.string().nullable(),
  httpStatus: z.number().nullable(),
  finalUrl: z.string().nullable(),
  checkedAt: z.string().nullable(),
  manualNote: z.string().nullable(),
  confirmedAt: z.string().nullable(),
});

export type Check = z.infer<typeof checkSchema>;

export const verificationContentSchema = z.object({
  checks: z.array(checkSchema),
  warnings: z.array(z.string()),
  source: z.object({ budgetStageId: z.string(), budgetVersion: z.number().int() }),
});

export type VerificationContent = z.infer<typeof verificationContentSchema>;

// Flights are not part of the plan; the user adds them with the link that shows the fare.
export const flightInputSchema = z
  .object({
    subject: z.string().trim().min(1).max(120),
    sourceUrl: z.url({ protocol: /^https?$/ }),
    amount: z.number().positive().optional(),
    currency: z.string().trim().toUpperCase().length(3).optional(),
    mustContain: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  })
  .refine((f) => f.amount !== undefined || (f.mustContain?.length ?? 0) > 0, {
    message: 'Provide an amount (with currency) or texts that must appear on the page',
  })
  .refine((f) => f.amount === undefined || f.currency !== undefined, {
    message: 'currency is required with amount',
    path: ['currency'],
  });

export type FlightInput = z.infer<typeof flightInputSchema>;

type NewCheck = Pick<Check, 'kind' | 'subject' | 'origin' | 'sourceUrl' | 'claim'>;

export function flightChecks(flights: FlightInput[]): NewCheck[] {
  return flights.map((f) => ({
    kind: 'FLIGHT' as const,
    subject: f.subject,
    origin: 'USER' as const,
    sourceUrl: f.sourceUrl,
    claim: { amount: f.amount ?? null, currency: f.currency ?? null, times: [], mustContain: f.mustContain ?? [] },
  }));
}

const KIND_BY_PREFIX: Record<string, Check['kind']> = { LOD: 'HOTEL', ATR: 'TICKET', MEAL: 'MEAL', TRN: 'TRANSPORT' };

// Everything the plan relies on: each price that is counted in the budget, and the opening hours of
// every attraction scheduled as a priority.
export function planChecks(budget: BudgetContent, route: RouteContent, days: DaysContent): NewCheck[] {
  const checks: NewCheck[] = [];

  for (const item of budget.items) {
    if (!item.counted) continue;
    const kind = KIND_BY_PREFIX[item.id.replace(/\d+$/, '')];
    if (!kind) continue;

    checks.push({
      kind,
      subject: item.label,
      origin: 'PLAN',
      sourceUrl: item.unitPrice.sourceUrl,
      claim: { amount: item.unitPrice.amount, currency: item.unitPrice.currency, times: [], mustContain: [] },
    });
  }

  const factsById = new Map(route.facts.map((f) => [f.id, f]));
  const scheduled = new Set(days.days.flatMap((d) => d.priorities.map((p) => p.attraction)));

  for (const attraction of route.attractions.filter((a) => scheduled.has(a.name))) {
    const hoursFacts = attraction.hours.factIds.map((id) => factsById.get(id)).filter((f) => f !== undefined);
    const source = hoursFacts.flatMap((f) => f.sources).find((s) => s.direct);
    // The times to look for come from the sentence found by the search, not from the model's paraphrase.
    const factText = hoursFacts.map((f) => f.text).join(' ');

    checks.push({
      kind: 'SCHEDULE',
      subject: `Horário: ${attraction.name}`,
      origin: 'PLAN',
      sourceUrl: source?.url ?? null,
      claim: { amount: null, currency: null, times: extractTimes(factText).map(formatTime), mustContain: [] },
    });
  }

  return checks;
}

type Result = Pick<Check, 'status' | 'reason' | 'evidence' | 'httpStatus' | 'finalUrl' | 'checkedAt'>;

const MIN_READABLE_CHARS = 200;

function evaluate(check: NewCheck, page: PageResult | null, now: Date): Result {
  const base = { evidence: null, httpStatus: null, finalUrl: null, checkedAt: now.toISOString() };
  const unresolved = (status: Result['status'], reason: string, extra: Partial<Result> = {}): Result => ({
    ...base,
    status,
    reason,
    ...extra,
  });

  if (!check.sourceUrl || !page) {
    return unresolved('NOT_CHECKABLE', 'Sem link de fonte para conferir; confirme manualmente');
  }

  if (!page.ok) {
    switch (page.reason) {
      case 'BLOCKED_HOST':
        return unresolved('NOT_CHECKABLE', page.detail);
      case 'NOT_TEXT':
        return unresolved('NOT_CHECKABLE', `${page.detail}; confirme manualmente`, { httpStatus: page.status ?? null });
      case 'HTTP_ERROR':
        return page.status === 401 || page.status === 403 || page.status === 407
          ? unresolved('NOT_CHECKABLE', `A página exige login ou bloqueou o acesso automático (HTTP ${page.status}); confirme manualmente`, { httpStatus: page.status })
          : unresolved('UNREACHABLE', page.detail, { httpStatus: page.status ?? null });
      default:
        return unresolved('UNREACHABLE', page.detail);
    }
  }

  const text = pageText(page.body);
  const found = { httpStatus: page.status, finalUrl: page.finalUrl };

  if (text.length < MIN_READABLE_CHARS) {
    return unresolved('NOT_CHECKABLE', 'A página não tem texto legível (provavelmente carrega o conteúdo por JavaScript); confirme manualmente', found);
  }

  const { amount, currency, times, mustContain } = check.claim;
  if (amount === null && times.length === 0 && mustContain.length === 0) {
    return unresolved('NOT_CHECKABLE', 'Não há valor, horário ou texto numérico para conferir automaticamente; confirme manualmente', found);
  }

  const evidence: string[] = [];
  const missing: string[] = [];

  if (amount !== null && currency) {
    const hit = findPrice(text, amount, currency);
    hit ? evidence.push(hit) : missing.push(`preço ${amount} ${currency}`);
  }
  for (const t of times) {
    const hit = findTime(text, Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)));
    hit ? evidence.push(hit) : missing.push(`horário ${t}`);
  }
  for (const needle of mustContain) {
    const hit = findText(text, needle);
    hit ? evidence.push(hit) : missing.push(`texto "${needle}"`);
  }

  return missing.length === 0
    ? { ...base, ...found, status: 'CONFIRMED', reason: null, evidence: [...new Set(evidence)].join(' | ') }
    : unresolved('NOT_FOUND_ON_PAGE', `Não encontrado na página: ${missing.join(', ')}. Pode estar escrito de outra forma; confirme manualmente`, found);
}

// Runs the checks (at most 4 pages at a time, each URL fetched once) and returns them with results.
export async function runChecks(checks: NewCheck[], now = new Date()): Promise<Omit<Check, 'id'>[]> {
  const pages = new Map<string, Promise<PageResult>>();
  const page = (url: string) => {
    if (!pages.has(url)) pages.set(url, fetchPage(url));
    return pages.get(url)!;
  };

  const results: Omit<Check, 'id'>[] = new Array(checks.length);
  let next = 0;

  const worker = async () => {
    while (next < checks.length) {
      const index = next++;
      const check = checks[index]!;
      const fetched = check.sourceUrl ? await page(check.sourceUrl) : null;

      results[index] = { ...check, ...evaluate(check, fetched, now), manualNote: null, confirmedAt: null };
    }
  };

  await Promise.all(Array.from({ length: Math.min(4, checks.length) }, worker));
  return results;
}

export function withIds(checks: Omit<Check, 'id'>[], startAt = 1): Check[] {
  return checks.map((check, index) => ({ id: `chk-${startAt + index}`, ...check }));
}

// Problems that block approving the verification (empty list = the plan is ready to book).
export function verificationSubmitProblems(content: VerificationContent): string[] {
  const problems: string[] = [];

  if (content.checks.length === 0) problems.push('There is nothing to verify');

  for (const check of content.checks) {
    if (check.status === 'CONFIRMED' && (!check.evidence || !check.checkedAt)) {
      problems.push(`${check.subject}: marked as confirmed without evidence`);
    } else if (check.status === 'MANUALLY_CONFIRMED') {
      if (!check.manualNote) problems.push(`${check.subject}: manual confirmation needs a note`);
    } else if (check.status !== 'CONFIRMED') {
      problems.push(`${check.subject}: ${check.status}${check.reason ? ` (${check.reason})` : ''}`);
    }
  }

  return problems;
}
