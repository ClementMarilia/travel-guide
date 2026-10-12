import { Router } from 'express';
import { z } from 'zod';
import { adapters } from '../ai/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { decryptSecret } from '../lib/crypto.js';
import { getPrisma } from '../lib/prisma.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  buildConstraintsContent,
  constraintsPrompt,
  constraintsProposalSchema,
} from '../planning/constraints.js';
import { interviewContentSchema } from '../planning/interview.js';
import { latestStageVersions } from '../planning/queries.js';
import { checkGeneration, saveGenerated } from './generation.js';
import { handleError, HttpError, loadTrip, unwrapGenerate } from './http.js';

const generateSchema = z.object({ regenerate: z.boolean().optional() });

// Mounted at /trips/:tripId/constraints (auth is applied by the trips router).
export const constraintsRouter = Router({ mergeParams: true });

// Asks the AI to turn the approved interview into structured constraints and stores them as a draft
// CONSTRAINTS stage. An existing draft is only replaced when `regenerate` is true.
constraintsRouter.post('/generate', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const { regenerate } = generateSchema.parse(request.body ?? {});
    const prisma = getPrisma();

    const latest = await latestStageVersions(trip.id);
    const current = checkGeneration('CONSTRAINTS', latest, regenerate);
    const interviewStage = latest.get('INTERVIEW')!;

    const interview = interviewContentSchema.safeParse(interviewStage.content);
    if (!interview.success || !interview.data.summary) {
      throw new HttpError(409, 'The approved interview content is invalid');
    }

    const settings = await prisma.aiSettings.findUnique({ where: { userId: request.userId! } });
    if (!settings) {
      throw new HttpError(409, 'Configure your AI provider key first');
    }

    const travelers = await prisma.traveler.findMany({
      where: { tripId: trip.id },
      orderBy: { createdAt: 'asc' },
      select: { name: true, nonNegotiable: true },
    });

    const { system, prompt } = constraintsPrompt(trip, travelers, interview.data);
    const text = unwrapGenerate(
      await adapters[settings.provider].generate(decryptSecret(settings.encryptedKey), settings.model, {
        system,
        prompt,
        json: true,
      }),
    ).text;

    let proposal;
    try {
      proposal = constraintsProposalSchema.parse(JSON.parse(text));
    } catch {
      throw new HttpError(502, 'The AI provider returned malformed constraints');
    }

    const content = buildConstraintsContent(proposal, travelers, interview.data, {
      interviewStageId: interviewStage.id,
      interviewVersion: interviewStage.version,
    }) as unknown as Prisma.InputJsonObject;

    const { stage, created } = await saveGenerated(trip.id, 'CONSTRAINTS', current, content);
    response.status(created ? 201 : 200).json({ stage });
  } catch (error) {
    handleError(error, response, 'Unable to generate constraints');
  }
});
