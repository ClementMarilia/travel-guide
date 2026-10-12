import { z } from 'zod';

export const STAGE_ORDER = [
  'INTERVIEW',
  'CONSTRAINTS',
  'BASE',
  'ROUTE',
  'DAYS',
  'BUDGET',
  'VERIFICATION',
] as const;

export type Stage = (typeof STAGE_ORDER)[number];
export type StageStatus = 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED';

export function previousStage(stage: Stage): Stage | null {
  const index = STAGE_ORDER.indexOf(stage);
  return index > 0 ? STAGE_ORDER[index - 1]! : null;
}

// A stage may start only when the stage before it has an APPROVED version.
export function canStartStage(stage: Stage, approvedStages: ReadonlySet<Stage>): boolean {
  const previous = previousStage(stage);
  return previous === null || approvedStages.has(previous);
}

// A price enters the budget only with a direct source link, consultation date and currency.
export const verifiedPriceSchema = z.object({
  amount: z.coerce.number().nonnegative(),
  currency: z.string().trim().toUpperCase().length(3),
  sourceUrl: z.url({ protocol: /^https?$/ }),
  consultedAt: z.coerce.date(),
});

export function resolvePrice(input: {
  amount?: unknown;
  currency?: unknown;
  sourceUrl?: unknown;
  consultedAt?: unknown;
}) {
  const parsed = verifiedPriceSchema.safeParse(input);

  if (!parsed.success) {
    return { status: 'NOT_VERIFIED' as const, amount: null, currency: null, sourceUrl: null, consultedAt: null };
  }

  return { status: 'VERIFIED' as const, ...parsed.data };
}
