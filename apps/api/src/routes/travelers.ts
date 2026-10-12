import { Router } from 'express';
import { z } from 'zod';
import { getPrisma } from '../lib/prisma.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { handleError, HttpError, loadTrip } from './http.js';

const MAX_TRAVELERS = 20;

const travelerFields = {
  name: z.string().trim().min(1).max(80),
  // The one item this traveler will not give up, e.g. "no tour starting at 7am".
  nonNegotiable: z.string().trim().min(1).max(300),
};

const createTravelerSchema = z.object(travelerFields);
const updateTravelerSchema = z.object(travelerFields).partial();
const travelerIdSchema = z.uuid();

// Mounted at /trips/:tripId/travelers (auth is applied by the trips router).
export const travelersRouter = Router({ mergeParams: true });

travelersRouter.get('/', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const travelers = await getPrisma().traveler.findMany({
      where: { tripId: trip.id },
      orderBy: { createdAt: 'asc' },
    });

    response.json({ travelers });
  } catch (error) {
    handleError(error, response, 'Unable to list travelers');
  }
});

travelersRouter.post('/', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const data = createTravelerSchema.parse(request.body);
    const prisma = getPrisma();

    if ((await prisma.traveler.count({ where: { tripId: trip.id } })) >= MAX_TRAVELERS) {
      throw new HttpError(409, `A trip can have at most ${MAX_TRAVELERS} travelers`);
    }

    const traveler = await prisma.traveler.create({ data: { ...data, tripId: trip.id } });
    response.status(201).json({ traveler });
  } catch (error) {
    handleError(error, response, 'Unable to add traveler');
  }
});

travelersRouter.patch('/:travelerId', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const id = travelerIdSchema.parse(request.params.travelerId);
    const data = updateTravelerSchema.parse(request.body);
    const prisma = getPrisma();

    const { count } = await prisma.traveler.updateMany({ where: { id, tripId: trip.id }, data });
    if (count === 0) {
      throw new HttpError(404, 'Traveler not found');
    }

    response.json({ traveler: await prisma.traveler.findUnique({ where: { id } }) });
  } catch (error) {
    handleError(error, response, 'Unable to update traveler');
  }
});

travelersRouter.delete('/:travelerId', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const id = travelerIdSchema.parse(request.params.travelerId);
    const { count } = await getPrisma().traveler.deleteMany({ where: { id, tripId: trip.id } });

    if (count === 0) {
      throw new HttpError(404, 'Traveler not found');
    }

    response.status(204).end();
  } catch (error) {
    handleError(error, response, 'Unable to remove traveler');
  }
});
