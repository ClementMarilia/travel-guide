import { Router } from 'express';
import { z } from 'zod';
import { adapters } from '../ai/index.js';
import { decryptSecret } from '../lib/crypto.js';
import { getPrisma } from '../lib/prisma.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  baseProposalSchema,
  buildBaseContent,
  researchPrompt,
  structurePrompt,
} from '../planning/base.js';
import { constraintsContentSchema } from '../planning/constraints.js';
import { latestStageVersions } from '../planning/queries.js';
import { extractFacts } from '../planning/research.js';
import { checkGeneration, saveGenerated } from './generation.js';
import { handleError, HttpError, loadTrip, unwrapGenerate } from './http.js';

const generateSchema = z.object({ regenerate: z.boolean().optional() });

// Mounted at /trips/:tripId/base (auth is applied by the trips router).
export const baseRouter = Router({ mergeParams: true });

// Researches candidate neighborhoods with web search (step 1), then structures the findings (step 2).
// Every fact keeps the sources the search found; anything without a source is flagged, never filled in.
baseRouter.post('/generate', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const { regenerate } = generateSchema.parse(request.body ?? {});
    const prisma = getPrisma();

    const latest = await latestStageVersions(trip.id);
    const current = checkGeneration('BASE', latest, regenerate);
    const constraintsStage = latest.get('CONSTRAINTS')!;

    const constraints = constraintsContentSchema.safeParse(constraintsStage.content);
    if (!constraints.success) {
      throw new HttpError(409, 'The approved constraints content is invalid');
    }

    const settings = await prisma.aiSettings.findUnique({ where: { userId: request.userId! } });
    if (!settings) {
      throw new HttpError(409, 'Configure your AI provider key first');
    }

    const adapter = adapters[settings.provider];
    const apiKey = decryptSecret(settings.encryptedKey);

    const research = researchPrompt(trip, constraints.data);
    const researched = unwrapGenerate(
      await adapter.generate(apiKey, settings.model, { ...research, search: true }),
    );

    const facts = await extractFacts(researched.text, researched.grounding, new Date());
    if (facts.length === 0) {
      throw new HttpError(502, 'The research did not return any usable facts');
    }

    const structure = structurePrompt(facts, constraints.data);
    const structured = unwrapGenerate(
      await adapter.generate(apiKey, settings.model, { ...structure, json: true }),
    );

    let proposal;
    try {
      proposal = baseProposalSchema.parse(JSON.parse(structured.text));
    } catch {
      throw new HttpError(502, 'The AI provider returned a malformed comparison');
    }

    const content = buildBaseContent(proposal, facts, researched.grounding?.queries ?? [], {
      constraintsStageId: constraintsStage.id,
      constraintsVersion: constraintsStage.version,
    });

    const { stage, created } = await saveGenerated(trip.id, 'BASE', current, content);
    response.status(created ? 201 : 200).json({ stage });
  } catch (error) {
    handleError(error, response, 'Unable to generate the base');
  }
});
