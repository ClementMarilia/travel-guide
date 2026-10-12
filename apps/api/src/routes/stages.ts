import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { getPrisma } from '../lib/prisma.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { handleError, HttpError, loadTrip } from './http.js';
import { constraintsContentSchema, submitProblems } from '../planning/constraints.js';
import { interviewContentSchema } from '../planning/interview.js';
import { latestStageVersions } from '../planning/queries.js';
import { canStartStage, STAGE_ORDER, previousStage, type Stage } from '../planning/stages.js';

const stageIdSchema = z.uuid();
const contentSchema = z.record(z.string(), z.unknown());

const startStageSchema = z.object({
  stage: z.enum(STAGE_ORDER),
  content: contentSchema.optional(),
});

const updateStageSchema = z.object({ content: contentSchema });

// Mounted at /trips/:tripId/stages (auth is applied by the trips router).
export const stagesRouter = Router({ mergeParams: true });

async function loadStage(request: AuthenticatedRequest) {
  const trip = await loadTrip(request);
  const id = stageIdSchema.parse(request.params.stageId);
  const stage = await getPrisma().tripStage.findFirst({ where: { id, tripId: trip.id } });

  if (!stage) {
    throw new HttpError(404, 'Stage not found');
  }

  return stage;
}

stagesRouter.get('/', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const stages = await getPrisma().tripStage.findMany({
      where: { tripId: trip.id },
      orderBy: [{ createdAt: 'asc' }],
    });

    response.json({ stages });
  } catch (error) {
    handleError(error, response, 'Unable to list stages');
  }
});

// Starts a stage (or a new version of it). The previous stage must be approved.
stagesRouter.post('/', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const data = startStageSchema.parse(request.body);
    const latest = await latestStageVersions(trip.id);

    const approved = new Set<Stage>();
    for (const [stage, row] of latest) {
      if (row.status === 'APPROVED') {
        approved.add(stage);
      }
    }

    if (!canStartStage(data.stage, approved)) {
      throw new HttpError(409, `Stage ${previousStage(data.stage)} must be approved first`);
    }

    const current = latest.get(data.stage);
    if (current && current.status !== 'APPROVED') {
      throw new HttpError(409, `Stage ${data.stage} is already in progress`);
    }

    const created = await getPrisma().tripStage.create({
      data: {
        tripId: trip.id,
        stage: data.stage,
        version: (current?.version ?? 0) + 1,
        content: (data.content ?? {}) as Prisma.InputJsonObject,
      },
    });

    response.status(201).json({ stage: created });
  } catch (error) {
    handleError(error, response, 'Unable to start stage');
  }
});

stagesRouter.get('/:stageId', async (request: AuthenticatedRequest, response) => {
  try {
    response.json({ stage: await loadStage(request) });
  } catch (error) {
    handleError(error, response, 'Unable to load stage');
  }
});

// Only a DRAFT can be edited. Once submitted or approved it is frozen.
stagesRouter.patch('/:stageId', async (request: AuthenticatedRequest, response) => {
  try {
    const stage = await loadStage(request);
    const data = updateStageSchema.parse(request.body);

    if (stage.status !== 'DRAFT') {
      throw new HttpError(409, 'Only a draft stage can be edited');
    }

    // Later stages rely on the constraints shape, so edits must keep it valid.
    if (stage.stage === 'CONSTRAINTS' && !constraintsContentSchema.safeParse(data.content).success) {
      throw new HttpError(400, 'Invalid constraints content');
    }

    const updated = await getPrisma().tripStage.update({
      where: { id: stage.id },
      data: { content: data.content as Prisma.InputJsonObject },
    });

    response.json({ stage: updated });
  } catch (error) {
    handleError(error, response, 'Unable to update stage');
  }
});

stagesRouter.post('/:stageId/submit', async (request: AuthenticatedRequest, response) => {
  try {
    const stage = await loadStage(request);

    if (stage.status !== 'DRAFT') {
      throw new HttpError(409, 'Only a draft stage can be submitted');
    }

    // An interview can only go to approval once it has been completed and summarized.
    if (stage.stage === 'INTERVIEW' && !interviewContentSchema.safeParse(stage.content).data?.summary) {
      throw new HttpError(409, 'Finish the interview before submitting it');
    }

    if (stage.stage === 'CONSTRAINTS') {
      const content = constraintsContentSchema.safeParse(stage.content);
      if (!content.success) {
        throw new HttpError(409, 'The constraints content is invalid');
      }

      const travelers = await getPrisma().traveler.findMany({
        where: { tripId: stage.tripId },
        select: { name: true, nonNegotiable: true },
      });
      const problems = submitProblems(content.data, travelers);
      if (problems.length > 0) {
        throw new HttpError(409, problems.join('; '));
      }
    }

    const updated = await getPrisma().tripStage.update({
      where: { id: stage.id },
      data: { status: 'AWAITING_APPROVAL' },
    });

    response.json({ stage: updated });
  } catch (error) {
    handleError(error, response, 'Unable to submit stage');
  }
});

// Sends a submitted stage back to DRAFT so it can be edited again.
stagesRouter.post('/:stageId/reopen', async (request: AuthenticatedRequest, response) => {
  try {
    const stage = await loadStage(request);

    if (stage.status !== 'AWAITING_APPROVAL') {
      throw new HttpError(409, 'Only a stage awaiting approval can be reopened');
    }

    const updated = await getPrisma().tripStage.update({
      where: { id: stage.id },
      data: { status: 'DRAFT' },
    });

    response.json({ stage: updated });
  } catch (error) {
    handleError(error, response, 'Unable to reopen stage');
  }
});

stagesRouter.post('/:stageId/approve', async (request: AuthenticatedRequest, response) => {
  try {
    const stage = await loadStage(request);

    if (stage.status !== 'AWAITING_APPROVAL') {
      throw new HttpError(409, 'Only a stage awaiting approval can be approved');
    }

    const latest = await latestStageVersions(stage.tripId);
    if (latest.get(stage.stage)?.id !== stage.id) {
      throw new HttpError(409, 'Only the latest version of a stage can be approved');
    }

    const updated = await getPrisma().tripStage.update({
      where: { id: stage.id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });

    response.json({ stage: updated });
  } catch (error) {
    handleError(error, response, 'Unable to approve stage');
  }
});
