import { Router } from 'express';
import { z } from 'zod';
import { adapters, DEFAULT_GEMINI_MODEL } from '../ai/index.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { getPrisma } from '../lib/prisma.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { handleError, HttpError } from './http.js';

// The model name ends up in a URL path, so only allow plain identifier characters.
const saveSettingsSchema = z.object({
  provider: z.enum(['GEMINI']).default('GEMINI'),
  model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,80}$/)
    .optional(),
  apiKey: z.string().trim().min(10).max(300).optional(),
});

const publicFields = { provider: true, model: true, keyLast4: true, updatedAt: true } as const;

export const aiRouter = Router();

aiRouter.use(requireAuth);

aiRouter.get('/settings', async (request: AuthenticatedRequest, response) => {
  try {
    const settings = await getPrisma().aiSettings.findUnique({
      where: { userId: request.userId! },
      select: publicFields,
    });

    response.json({ settings });
  } catch (error) {
    handleError(error, response, 'Unable to load AI settings');
  }
});

// Creates or updates the settings. The key is required the first time; afterwards it can be omitted
// to change only the model. The key is never returned, only its last 4 characters.
aiRouter.put('/settings', async (request: AuthenticatedRequest, response) => {
  try {
    const data = saveSettingsSchema.parse(request.body);
    const prisma = getPrisma();
    const userId = request.userId!;
    const existing = await prisma.aiSettings.findUnique({ where: { userId } });

    if (!existing && !data.apiKey) {
      throw new HttpError(400, 'apiKey is required');
    }

    const settings = existing
      ? await prisma.aiSettings.update({
          where: { userId },
          data: {
            provider: data.provider,
            ...(data.model && { model: data.model }),
            ...(data.apiKey && {
              encryptedKey: encryptSecret(data.apiKey),
              keyLast4: data.apiKey.slice(-4),
            }),
          },
          select: publicFields,
        })
      : await prisma.aiSettings.create({
          data: {
            userId,
            provider: data.provider,
            model: data.model ?? DEFAULT_GEMINI_MODEL,
            encryptedKey: encryptSecret(data.apiKey!),
            keyLast4: data.apiKey!.slice(-4),
          },
          select: publicFields,
        });

    response.json({ settings });
  } catch (error) {
    handleError(error, response, 'Unable to save AI settings');
  }
});

aiRouter.delete('/settings', async (request: AuthenticatedRequest, response) => {
  try {
    await getPrisma().aiSettings.deleteMany({ where: { userId: request.userId! } });
    response.status(204).end();
  } catch (error) {
    handleError(error, response, 'Unable to remove AI settings');
  }
});

aiRouter.post('/settings/test', async (request: AuthenticatedRequest, response) => {
  try {
    const settings = await getPrisma().aiSettings.findUnique({ where: { userId: request.userId! } });

    if (!settings) {
      throw new HttpError(404, 'AI settings not configured');
    }

    const result = await adapters[settings.provider].testConnection(
      decryptSecret(settings.encryptedKey),
      settings.model,
    );

    response.status(result.ok ? 200 : 422).json(result);
  } catch (error) {
    handleError(error, response, 'Unable to test AI connection');
  }
});
