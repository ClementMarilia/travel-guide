import { Router } from 'express';
import { z } from 'zod';
import { adapters } from '../ai/index.js';
import { decryptSecret } from '../lib/crypto.js';
import { getPrisma } from '../lib/prisma.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { baseContentSchema } from '../planning/base.js';
import { constraintsContentSchema } from '../planning/constraints.js';
import { latestStageVersions } from '../planning/queries.js';
import { extractFacts } from '../planning/research.js';
import {
  buildRouteContent,
  routeProposalSchema,
  routeResearchPrompt,
  routeStructurePrompt,
} from '../planning/route.js';
import { checkGeneration, saveGenerated } from './generation.js';
import { handleError, HttpError, loadTrip, unwrapGenerate } from './http.js';

const generateSchema = z.object({ regenerate: z.boolean().optional() });

// Mounted at /trips/:tripId/route (auth is applied by the trips router).
export const routeStageRouter = Router({ mergeParams: true });

// Same two steps as the base: research the attractions around the approved base with web search,
// then group them into clusters. Days are not assigned here; that is the DAYS stage.
routeStageRouter.post('/generate', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const { regenerate } = generateSchema.parse(request.body ?? {});
    const prisma = getPrisma();

    const latest = await latestStageVersions(trip.id);
    const current = checkGeneration('ROUTE', latest, regenerate);
    const baseStage = latest.get('BASE')!;
    const constraintsStage = latest.get('CONSTRAINTS');

    const base = baseContentSchema.safeParse(baseStage.content);
    const constraints = constraintsContentSchema.safeParse(constraintsStage?.content);
    if (!base.success || !constraints.success) {
      throw new HttpError(409, 'The approved base or constraints content is invalid');
    }

    const settings = await prisma.aiSettings.findUnique({ where: { userId: request.userId! } });
    if (!settings) {
      throw new HttpError(409, 'Configure your AI provider key first');
    }

    const adapter = adapters[settings.provider];
    const apiKey = decryptSecret(settings.encryptedKey);

    const researched = unwrapGenerate(
      await adapter.generate(apiKey, settings.model, {
        ...routeResearchPrompt(trip, constraints.data, base.data),
        search: true,
      }),
    );

    const facts = await extractFacts(researched.text, researched.grounding, new Date());
    if (facts.length === 0) {
      throw new HttpError(502, 'The research did not return any usable facts');
    }

    const structured = unwrapGenerate(
      await adapter.generate(apiKey, settings.model, {
        ...routeStructurePrompt(facts, constraints.data, base.data),
        json: true,
      }),
    );

    let proposal;
    try {
      proposal = routeProposalSchema.parse(JSON.parse(structured.text));
    } catch {
      throw new HttpError(502, 'The AI provider returned a malformed route');
    }

    const content = buildRouteContent(
      proposal,
      facts,
      researched.grounding?.queries ?? [],
      base.data.recommendation.neighborhood,
      { baseStageId: baseStage.id, baseVersion: baseStage.version },
    );

    const { stage, created } = await saveGenerated(trip.id, 'ROUTE', current, content);
    response.status(created ? 201 : 200).json({ stage });
  } catch (error) {
    handleError(error, response, 'Unable to generate the route');
  }
});
