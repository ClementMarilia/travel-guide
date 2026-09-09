import cors from 'cors';
import express from 'express';
import { getPrisma } from './lib/prisma.js';

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

app.listen(port, () => {
  console.log(`Travel Guide API running on port ${port}`);
});
