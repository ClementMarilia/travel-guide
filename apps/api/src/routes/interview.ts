import { Router } from 'express';
import { z } from 'zod';
import { adapters } from '../ai/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { decryptSecret } from '../lib/crypto.js';
import { getPrisma } from '../lib/prisma.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  INTERVIEW_TOPICS,
  interviewContentSchema,
  questionPrompt,
  summaryPrompt,
  summaryResponseSchema,
  type InterviewContent,
} from '../planning/interview.js';
import { handleError, HttpError, loadTrip, unwrapGenerate } from './http.js';

const answerSchema = z.object({ answer: z.string().trim().min(1).max(1000).optional() });

// Mounted at /trips/:tripId/interview (auth is applied by the trips router).
export const interviewRouter = Router({ mergeParams: true });

// One step of the interview: records the answer to the pending question (if any), then either
// asks the next question or, after the last one, summarizes the answers and flags conflicts.
// Nothing is saved if the AI call fails, so the same answer can simply be sent again.
interviewRouter.post('/answer', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const { answer } = answerSchema.parse(request.body ?? {});
    const prisma = getPrisma();

    if (!trip.destination) {
      throw new HttpError(409, 'Set the trip destination before starting the interview');
    }

    const travelers = await prisma.traveler.findMany({
      where: { tripId: trip.id },
      orderBy: { createdAt: 'asc' },
      select: { name: true, nonNegotiable: true },
    });
    if (travelers.length === 0) {
      throw new HttpError(409, 'Add at least one traveler before starting the interview');
    }

    const settings = await prisma.aiSettings.findUnique({ where: { userId: request.userId! } });
    if (!settings) {
      throw new HttpError(409, 'Configure your AI provider key first');
    }

    // INTERVIEW has no prerequisite, so the first call creates the stage.
    let stage = await prisma.tripStage.findFirst({
      where: { tripId: trip.id, stage: 'INTERVIEW' },
      orderBy: { version: 'desc' },
    });
    if (!stage) {
      stage = await prisma.tripStage.create({ data: { tripId: trip.id, stage: 'INTERVIEW' } });
    }
    if (stage.status !== 'DRAFT') {
      throw new HttpError(409, 'The interview is no longer a draft');
    }

    const parsed = interviewContentSchema.safeParse(stage.content);
    if (!parsed.success) {
      throw new HttpError(409, 'The interview content is invalid');
    }
    const content = parsed.data;

    if (content.summary) {
      throw new HttpError(409, 'The interview is complete; submit it for approval');
    }
    if (content.pending && !answer) {
      throw new HttpError(400, 'An answer to the pending question is required');
    }
    if (!content.pending && answer) {
      throw new HttpError(400, 'There is no pending question to answer');
    }

    const next: InterviewContent = {
      ...content,
      answers: content.pending && answer ? [...content.answers, { ...content.pending, answer }] : content.answers,
      pending: null,
    };

    const context = { ...trip, destination: trip.destination, travelers };
    const apiKey = decryptSecret(settings.encryptedKey);
    const adapter = adapters[settings.provider];
    const topic = INTERVIEW_TOPICS[next.answers.length];

    let reply: Record<string, unknown>;

    if (topic) {
      const { system, prompt } = questionPrompt(topic, context, next);
      const question = unwrapGenerate(await adapter.generate(apiKey, settings.model, { system, prompt })).text;

      next.pending = { topic, question };
      reply = {
        done: false,
        question: { topic, text: question, number: next.answers.length + 1, total: INTERVIEW_TOPICS.length },
      };
    } else {
      const { system, prompt } = summaryPrompt(context, next);
      const text = unwrapGenerate(
        await adapter.generate(apiKey, settings.model, { system, prompt, json: true }),
      ).text;

      let result: z.infer<typeof summaryResponseSchema>;
      try {
        result = summaryResponseSchema.parse(JSON.parse(text));
      } catch {
        throw new HttpError(502, 'The AI provider returned a malformed summary');
      }

      next.summary = result.summary;
      next.conflicts = result.conflicts;
      reply = { done: true, summary: result.summary, conflicts: result.conflicts };
    }

    // Optimistic lock: refuse to overwrite if another request changed the stage meanwhile.
    const { count } = await prisma.tripStage.updateMany({
      where: { id: stage.id, updatedAt: stage.updatedAt, status: 'DRAFT' },
      data: { content: next as Prisma.InputJsonObject },
    });
    if (count === 0) {
      throw new HttpError(409, 'The interview changed in the meantime, try again');
    }

    response.json({ stageId: stage.id, ...reply });
  } catch (error) {
    handleError(error, response, 'Unable to continue the interview');
  }
});
