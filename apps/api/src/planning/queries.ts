import { getPrisma } from '../lib/prisma.js';
import type { Stage } from './stages.js';

// The newest version of each stage is the one that counts.
export async function latestStageVersions(tripId: string) {
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
