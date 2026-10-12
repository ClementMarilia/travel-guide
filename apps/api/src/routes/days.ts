import { Router } from 'express';
import { z } from 'zod';
import { adapters } from '../ai/index.js';
import { decryptSecret } from '../lib/crypto.js';
import { getPrisma } from '../lib/prisma.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { constraintsContentSchema } from '../planning/constraints.js';
import {
  buildDaysContent,
  buildLimits,
  daysProposalSchema,
  daysResearchPrompt,
  daysStructurePrompt,
} from '../planning/days.js';
import { latestStageVersions } from '../planning/queries.js';
import { extractFacts } from '../planning/research.js';
import { routeContentSchema, tripDays } from '../planning/route.js';
import { checkGeneration, saveGenerated } from './generation.js';
import { handleError, HttpError, loadTrip, unwrapGenerate } from './http.js';

const generateSchema = z.object({
  regenerate: z.boolean().optional(),
  // Overrides the limit from the approved constraints.
  maxPrioritiesPerDay: z.number().int().min(1).max(10).optional(),
});

// Mounted at /trips/:tripId/days (auth is applied by the trips router).
export const daysRouter = Router({ mergeParams: true });

// Distributes the approved route over the trip days: researches travel times, places to eat, queues
// and rain options with web search, then structures the days. The server enforces the daily limit,
// one-use-per-attraction and the times the travelers wanted to avoid.
daysRouter.post('/generate', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const body = generateSchema.parse(request.body ?? {});
    const prisma = getPrisma();

    const latest = await latestStageVersions(trip.id);
    const current = checkGeneration('DAYS', latest, body.regenerate);
    const routeStage = latest.get('ROUTE')!;

    const route = routeContentSchema.safeParse(routeStage.content);
    const constraints = constraintsContentSchema.safeParse(latest.get('CONSTRAINTS')?.content);
    if (!route.success || !constraints.success) {
      throw new HttpError(409, 'The approved route or constraints content is invalid');
    }

    const days = tripDays(trip);
    if (!days || !trip.startDate) {
      throw new HttpError(409, 'Set the trip start and end dates before building the days');
    }

    const maxPrioritiesPerDay = body.maxPrioritiesPerDay ?? constraints.data.pace.maxPrioritiesPerDay;
    if (!maxPrioritiesPerDay) {
      throw new HttpError(409, 'Send maxPrioritiesPerDay: the approved constraints do not define it');
    }

    const settings = await prisma.aiSettings.findUnique({ where: { userId: request.userId! } });
    if (!settings) {
      throw new HttpError(409, 'Configure your AI provider key first');
    }

    const adapter = adapters[settings.provider];
    const apiKey = decryptSecret(settings.encryptedKey);

    const researched = unwrapGenerate(
      await adapter.generate(apiKey, settings.model, {
        ...daysResearchPrompt(trip, constraints.data, route.data),
        search: true,
      }),
    );

    const facts = await extractFacts(researched.text, researched.grounding, new Date());
    if (facts.length === 0) {
      throw new HttpError(502, 'The research did not return any usable facts');
    }

    const preview = buildLimits(constraints.data, route.data, days, maxPrioritiesPerDay);
    const structured = unwrapGenerate(
      await adapter.generate(apiKey, settings.model, {
        ...daysStructurePrompt(facts, constraints.data, route.data, preview),
        json: true,
      }),
    );

    let proposal;
    try {
      proposal = daysProposalSchema.parse(JSON.parse(structured.text));
    } catch {
      throw new HttpError(502, 'The AI provider returned a malformed schedule');
    }

    const content = buildDaysContent(
      proposal,
      facts,
      researched.grounding?.queries ?? [],
      { route: route.data, constraints: constraints.data, startDate: trip.startDate, days, maxPrioritiesPerDay },
      { routeStageId: routeStage.id, routeVersion: routeStage.version },
    );

    const { stage, created } = await saveGenerated(trip.id, 'DAYS', current, content);
    response.status(created ? 201 : 200).json({ stage });
  } catch (error) {
    handleError(error, response, 'Unable to generate the days');
  }
});
