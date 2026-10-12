import type { Prisma } from '../generated/prisma/client.js';
import { getPrisma } from '../lib/prisma.js';
import { previousStage, type Stage } from '../planning/stages.js';
import { latestStageVersions } from '../planning/queries.js';
import { HttpError } from './http.js';

type Latest = Awaited<ReturnType<typeof latestStageVersions>>;

// Shared rules for "generate this stage with AI": the previous stage must be approved, a stage
// awaiting approval is left alone, and an existing draft is only replaced on request.
export function checkGeneration(stage: Stage, latest: Latest, regenerate: boolean | undefined) {
  const previous = previousStage(stage);
  if (previous && latest.get(previous)?.status !== 'APPROVED') {
    throw new HttpError(409, `Stage ${previous} must be approved first`);
  }

  const current = latest.get(stage);
  if (current?.status === 'AWAITING_APPROVAL') {
    throw new HttpError(409, `The ${stage} stage is awaiting approval; reopen it first`);
  }
  if (current?.status === 'DRAFT' && !regenerate) {
    throw new HttpError(409, 'A draft already exists; send regenerate: true to replace it');
  }

  return current;
}

// Replaces the current draft (with an optimistic lock) or creates the next version of the stage.
export async function saveGenerated(
  tripId: string,
  stage: Stage,
  current: Latest extends Map<Stage, infer Row> ? Row | undefined : never,
  content: unknown,
) {
  const prisma = getPrisma();
  const json = content as Prisma.InputJsonObject;

  if (current?.status === 'DRAFT') {
    const { count } = await prisma.tripStage.updateMany({
      where: { id: current.id, updatedAt: current.updatedAt, status: 'DRAFT' },
      data: { content: json },
    });
    if (count === 0) {
      throw new HttpError(409, 'The draft changed in the meantime, try again');
    }

    return { stage: await prisma.tripStage.findUniqueOrThrow({ where: { id: current.id } }), created: false };
  }

  const created = await prisma.tripStage.create({
    data: { tripId, stage, version: (current?.version ?? 0) + 1, content: json },
  });

  return { stage: created, created: true };
}
