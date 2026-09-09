import cors from 'cors';
import express from 'express';
import { ZodError } from 'zod';
import { loginUser, registerUser } from './auth.js';
import { getPrisma } from './lib/prisma.js';
import { requireAuth, type AuthenticatedRequest } from './middleware/auth.js';

const app = express();
const port = Number(process.env.PORT ?? 3333);

app.use(cors());
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', service: 'travel-guide-api' });
});

app.get('/health/database', async (_request, response) => {
  try {
    const prisma = getPrisma();
    await prisma.$queryRaw`SELECT 1`;

    response.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error';

    response.status(503).json({
      status: 'error',
      database: 'disconnected',
      message,
    });
  }
});

app.post('/auth/register', async (request, response) => {
  try {
    const result = await registerUser(request.body);
    response.status(201).json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({ message: 'Invalid registration data', issues: error.issues });
      return;
    }

    if (error instanceof Error && error.message === 'EMAIL_ALREADY_IN_USE') {
      response.status(409).json({ message: 'Email already in use' });
      return;
    }

    response.status(500).json({ message: 'Unable to create account' });
  }
});

app.post('/auth/login', async (request, response) => {
  try {
    const result = await loginUser(request.body);
    response.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({ message: 'Invalid login data', issues: error.issues });
      return;
    }

    if (error instanceof Error && error.message === 'INVALID_CREDENTIALS') {
      response.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    response.status(500).json({ message: 'Unable to login' });
  }
});

app.get('/auth/me', requireAuth, async (request: AuthenticatedRequest, response) => {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: request.userId },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  if (!user) {
    response.status(404).json({ message: 'User not found' });
    return;
  }

  response.json({ user });
});

app.listen(port, () => {
  console.log(`Travel Guide API running on port ${port}`);
});
