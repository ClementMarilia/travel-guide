import { Router, type Response } from 'express';
import { ZodError, z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { getPrisma } from '../lib/prisma.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { canStartStage, STAGE_ORDER, previousStage, type Stage } from '../planning/stages.js';

const tripIdSchema = z.uuid();
const stageIdSchema = z.uuid();
const contentSchema = z.record(z.string(), z.unknown());

const startStageSchema = z.object({
  stage: z.enum(STAGE_ORDER),
  content: contentSchema.optional(),
});

const updateStageSchema = z.object({ content: contentSchema });

// Mounted at /trips/:tripId/stages (auth is applied by the trips router).
export const stagesRouter = Router({ mergeParams: true });

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function loadTrip(request: AuthenticatedRequest) {
  const tripId = tripIdSchema.parse(request.params.tripId);
  const trip = await getPrisma().trip.findFirst({ where: { id: tripId, ownerId: request.userId } });

  if (!trip) {
    throw new HttpError(404, 'Trip not found');
  }

  return trip;
}

// The newest version of each stage is the one that counts.
async function latestVersions(tripId: string) {
  const rows = await getPrisma().tripStage.findMany({
    where: { tripId },
    orderBy: [{ stage: 'asc' }, { version: 'desc' }],
  });
  const latest = new Map<Stage, (typeof rows)[number]>();

  for (const row of rows) {
    if (!latest.has(row.stage)) {
      latest.set(row.stage, row);
    }
  }

  return latest;
}

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
    const latest = await latestVersions(trip.id);

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

    const latest = await latestVersions(stage.tripId);
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

function handleError(error: unknown, response: Response, fallback: string) {
  if (error instanceof HttpError) {
    response.status(error.status).json({ message: error.message });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({ message: 'Invalid data', issues: error.issues });
    return;
  }

  // Unique (tripId, stage, version) violation: two requests raced to start the same stage.
  if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') {
    response.status(409).json({ message: 'Stage was started concurrently' });
    return;
  }

  response.status(500).json({ message: fallback });
}
