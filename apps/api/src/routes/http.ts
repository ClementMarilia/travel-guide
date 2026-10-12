import type { Response } from 'express';
import { ZodError, z } from 'zod';
import { getPrisma } from '../lib/prisma.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Loads the trip in `:tripId`, scoped to the authenticated owner.
export async function loadTrip(request: AuthenticatedRequest) {
  const tripId = z.uuid().parse(request.params.tripId);
  const trip = await getPrisma().trip.findFirst({ where: { id: tripId, ownerId: request.userId } });

  if (!trip) {
    throw new HttpError(404, 'Trip not found');
  }

  return trip;
}

export function handleError(error: unknown, response: Response, fallback: string) {
  if (error instanceof HttpError) {
    response.status(error.status).json({ message: error.message });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({ message: 'Invalid data', issues: error.issues });
    return;
  }

  // Unique constraint violation: two requests raced to create the same row.
  if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') {
    response.status(409).json({ message: 'Conflicting concurrent request' });
    return;
  }

  response.status(500).json({ message: fallback });
}
