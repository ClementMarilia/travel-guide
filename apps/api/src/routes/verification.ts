import { Router } from 'express';
import { z } from 'zod';
import { getPrisma } from '../lib/prisma.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { budgetContentSchema } from '../planning/budget.js';
import { daysContentSchema } from '../planning/days.js';
import { latestStageVersions } from '../planning/queries.js';
import { routeContentSchema } from '../planning/route.js';
import {
  flightChecks,
  flightInputSchema,
  planChecks,
  runChecks,
  verificationContentSchema,
  withIds,
  type VerificationContent,
} from '../planning/verification.js';
import { checkGeneration, saveGenerated } from './generation.js';
import { handleError, HttpError, loadTrip } from './http.js';

const generateSchema = z.object({
  regenerate: z.boolean().optional(),
  flights: z.array(flightInputSchema).max(20).optional(),
});
const flightsSchema = z.object({ flights: z.array(flightInputSchema).min(1).max(20) });
const confirmSchema = z.object({ note: z.string().trim().min(3).max(500) });

// Mounted at /trips/:tripId/verification (auth is applied by the trips router).
export const verificationRouter = Router({ mergeParams: true });

// The verification is edited only through these endpoints (the generic stage PATCH is refused), so a
// result can never be written by hand: it comes from a page fetched by the server, or from an explicit
// manual confirmation with a note.
async function loadDraft(tripId: string) {
  const current = (await latestStageVersions(tripId)).get('VERIFICATION');

  if (!current || current.status !== 'DRAFT') {
    throw new HttpError(409, 'There is no draft verification; generate it first');
  }

  const content = verificationContentSchema.safeParse(current.content);
  if (!content.success) {
    throw new HttpError(409, 'The verification content is invalid; regenerate it');
  }

  return { current, content: content.data };
}

// Opens the source behind every price and schedule in the plan (and the flights you provide) and
// checks that the claimed value really appears on the page.
verificationRouter.post('/generate', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const body = generateSchema.parse(request.body ?? {});

    const latest = await latestStageVersions(trip.id);
    const current = checkGeneration('VERIFICATION', latest, body.regenerate);
    const budgetStage = latest.get('BUDGET')!;

    const budget = budgetContentSchema.safeParse(budgetStage.content);
    const route = routeContentSchema.safeParse(latest.get('ROUTE')?.content);
    const days = daysContentSchema.safeParse(latest.get('DAYS')?.content);
    if (!budget.success || !route.success || !days.success) {
      throw new HttpError(409, 'The approved stages content is invalid');
    }

    const checks = withIds(
      await runChecks([...planChecks(budget.data, route.data, days.data), ...flightChecks(body.flights ?? [])]),
    );

    const content: VerificationContent = {
      checks,
      warnings: body.flights?.length ? [] : ['Nenhum voo foi informado; voos não fazem parte do plano e não foram conferidos'],
      source: { budgetStageId: budgetStage.id, budgetVersion: budgetStage.version },
    };

    const { stage, created } = await saveGenerated(trip.id, 'VERIFICATION', current, content);
    response.status(created ? 201 : 200).json({ stage });
  } catch (error) {
    handleError(error, response, 'Unable to generate the verification');
  }
});

verificationRouter.post('/flights', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const { flights } = flightsSchema.parse(request.body ?? {});
    const { current, content } = await loadDraft(trip.id);

    const added = withIds(await runChecks(flightChecks(flights)), content.checks.length + 1);
    const next: VerificationContent = {
      ...content,
      checks: [...content.checks, ...added],
      warnings: content.warnings.filter((w) => !w.startsWith('Nenhum voo')),
    };

    const { stage } = await saveGenerated(trip.id, 'VERIFICATION', current, next);
    response.json({ stage });
  } catch (error) {
    handleError(error, response, 'Unable to add flights');
  }
});

// Runs again every check that was not confirmed by hand (for example after a page was temporarily down).
verificationRouter.post('/recheck', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const { current, content } = await loadDraft(trip.id);

    const pending = content.checks.filter((c) => c.status !== 'MANUALLY_CONFIRMED');
    const results = await runChecks(pending);
    const byId = new Map(pending.map((c, i) => [c.id, results[i]!]));

    const next: VerificationContent = {
      ...content,
      checks: content.checks.map((c) => (byId.has(c.id) ? { id: c.id, ...byId.get(c.id)! } : c)),
    };

    const { stage } = await saveGenerated(trip.id, 'VERIFICATION', current, next);
    response.json({ stage });
  } catch (error) {
    handleError(error, response, 'Unable to recheck');
  }
});

// For what the server cannot read on its own (login, JavaScript, PDFs): you opened the source and
// confirm it yourself, with a note saying what you saw.
verificationRouter.post('/checks/:checkId/confirm', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const { note } = confirmSchema.parse(request.body ?? {});
    const { current, content } = await loadDraft(trip.id);

    const target = content.checks.find((c) => c.id === request.params.checkId);
    if (!target) {
      throw new HttpError(404, 'Check not found');
    }
    if (target.status === 'CONFIRMED') {
      throw new HttpError(409, 'This check was already confirmed automatically');
    }

    const next: VerificationContent = {
      ...content,
      checks: content.checks.map((c) =>
        c.id === target.id
          ? { ...c, status: 'MANUALLY_CONFIRMED' as const, manualNote: note, confirmedAt: new Date().toISOString() }
          : c,
      ),
    };

    const { stage } = await saveGenerated(trip.id, 'VERIFICATION', current, next);
    response.json({ stage });
  } catch (error) {
    handleError(error, response, 'Unable to confirm the check');
  }
});
