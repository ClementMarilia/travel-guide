import { Router } from 'express';
import { ZodError, z } from 'zod';
import { getPrisma } from '../lib/prisma.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { baseRouter } from './base.js';
import { budgetRouter } from './budget.js';
import { constraintsRouter } from './constraints.js';
import { daysRouter } from './days.js';
import { interviewRouter } from './interview.js';
import { routeStageRouter } from './route-stage.js';
import { stagesRouter } from './stages.js';
import { travelersRouter } from './travelers.js';
import { verificationRouter } from './verification.js';

const statusValues = ['PLANNING', 'UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const;

const tripFields = {
  title: z.string().trim().min(1).max(120),
  destination: z.string().trim().min(1).max(120).nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  currency: z.string().trim().toUpperCase().length(3),
  status: z.enum(statusValues),
  notes: z.string().trim().max(5000).nullable().optional(),
};

const datesAreOrdered = (data: { startDate?: Date | null; endDate?: Date | null }) =>
  !data.startDate || !data.endDate || data.endDate >= data.startDate;
const datesError = { message: 'endDate must not be before startDate', path: ['endDate'] };

const createTripSchema = z
  .object({
    ...tripFields,
    currency: tripFields.currency.default('EUR'),
    status: tripFields.status.default('PLANNING'),
  })
  .refine(datesAreOrdered, datesError);

const updateTripSchema = z.object(tripFields).partial().refine(datesAreOrdered, datesError);

const idSchema = z.uuid();

export const tripsRouter = Router();

tripsRouter.use(requireAuth);
tripsRouter.use('/:tripId/stages', stagesRouter);
tripsRouter.use('/:tripId/interview', interviewRouter);
tripsRouter.use('/:tripId/constraints', constraintsRouter);
tripsRouter.use('/:tripId/base', baseRouter);
tripsRouter.use('/:tripId/route', routeStageRouter);
tripsRouter.use('/:tripId/days', daysRouter);
tripsRouter.use('/:tripId/budget', budgetRouter);
tripsRouter.use('/:tripId/verification', verificationRouter);
tripsRouter.use('/:tripId/travelers', travelersRouter);

tripsRouter.get('/', async (request: AuthenticatedRequest, response) => {
  const trips = await getPrisma().trip.findMany({
    where: { ownerId: request.userId },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
  });

  response.json({ trips });
});

tripsRouter.post('/', async (request: AuthenticatedRequest, response) => {
  try {
    const data = createTripSchema.parse(request.body);
    const trip = await getPrisma().trip.create({ data: { ...data, ownerId: request.userId! } });
    response.status(201).json({ trip });
  } catch (error) {
    handleError(error, response, 'Unable to create trip');
  }
});

tripsRouter.get('/:id', async (request: AuthenticatedRequest, response) => {
  try {
    const id = idSchema.parse(request.params.id);
    const trip = await getPrisma().trip.findFirst({ where: { id, ownerId: request.userId } });

    if (!trip) {
      response.status(404).json({ message: 'Trip not found' });
      return;
    }

    response.json({ trip });
  } catch (error) {
    handleError(error, response, 'Unable to load trip');
  }
});

tripsRouter.patch('/:id', async (request: AuthenticatedRequest, response) => {
  try {
    const id = idSchema.parse(request.params.id);
    const data = updateTripSchema.parse(request.body);
    const prisma = getPrisma();

    const { count } = await prisma.trip.updateMany({ where: { id, ownerId: request.userId }, data });
    if (count === 0) {
      response.status(404).json({ message: 'Trip not found' });
      return;
    }

    const trip = await prisma.trip.findUnique({ where: { id } });
    response.json({ trip });
  } catch (error) {
    handleError(error, response, 'Unable to update trip');
  }
});

tripsRouter.delete('/:id', async (request: AuthenticatedRequest, response) => {
  try {
    const id = idSchema.parse(request.params.id);
    const { count } = await getPrisma().trip.deleteMany({
      where: { id, ownerId: request.userId },
    });

    if (count === 0) {
      response.status(404).json({ message: 'Trip not found' });
      return;
    }

    response.status(204).end();
  } catch (error) {
    handleError(error, response, 'Unable to delete trip');
  }
});

function handleError(error: unknown, response: import('express').Response, fallback: string) {
  if (error instanceof ZodError) {
    response.status(400).json({ message: 'Invalid data', issues: error.issues });
    return;
  }

  response.status(500).json({ message: fallback });
}
