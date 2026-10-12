import { Router } from 'express';
import { z } from 'zod';
import { adapters } from '../ai/index.js';
import { decryptSecret } from '../lib/crypto.js';
import { getPrisma } from '../lib/prisma.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { baseContentSchema } from '../planning/base.js';
import {
  budgetProposalSchema,
  budgetStructurePrompt,
  buildBudgetContent,
  collectStageItems,
  decisionsPrompt,
  decisionsSchema,
  transportResearchPrompt,
} from '../planning/budget.js';
import { constraintsContentSchema } from '../planning/constraints.js';
import { daysContentSchema } from '../planning/days.js';
import { latestStageVersions } from '../planning/queries.js';
import { extractFacts } from '../planning/research.js';
import { routeContentSchema } from '../planning/route.js';
import { checkGeneration, saveGenerated } from './generation.js';
import { handleError, HttpError, loadTrip, unwrapGenerate } from './http.js';

const generateSchema = z.object({
  regenerate: z.boolean().optional(),
  // Quantities the prices are multiplied by. Defaults: registered travelers, one room.
  people: z.number().int().min(1).max(100).optional(),
  rooms: z.number().int().min(1).max(50).optional(),
});

// Mounted at /trips/:tripId/budget (auth is applied by the trips router).
export const budgetRouter = Router({ mergeParams: true });

// Builds the budget from the prices already verified in the approved stages, plus a web search for
// transport fares. The model names units, proposes the split and writes the risk decisions; the
// arithmetic, the totals and the risks are computed by the server.
budgetRouter.post('/generate', async (request: AuthenticatedRequest, response) => {
  try {
    const trip = await loadTrip(request);
    const body = generateSchema.parse(request.body ?? {});
    const prisma = getPrisma();

    const latest = await latestStageVersions(trip.id);
    const current = checkGeneration('BUDGET', latest, body.regenerate);
    const daysStage = latest.get('DAYS')!;

    const base = baseContentSchema.safeParse(latest.get('BASE')?.content);
    const route = routeContentSchema.safeParse(latest.get('ROUTE')?.content);
    const days = daysContentSchema.safeParse(daysStage.content);
    const constraints = constraintsContentSchema.safeParse(latest.get('CONSTRAINTS')?.content);
    if (!base.success || !route.success || !days.success || !constraints.success) {
      throw new HttpError(409, 'The approved stages content is invalid');
    }

    const total = constraints.data.budget.total;
    if (!total || total <= 0) {
      throw new HttpError(409, 'The approved constraints do not define a total budget');
    }

    const settings = await prisma.aiSettings.findUnique({ where: { userId: request.userId! } });
    if (!settings) {
      throw new HttpError(409, 'Configure your AI provider key first');
    }

    const travelers = await prisma.traveler.count({ where: { tripId: trip.id } });
    const inputs = {
      currency: constraints.data.budget.currency,
      total,
      days: days.data.limits.days,
      nights: Math.max(days.data.limits.days - 1, 0),
      people: body.people ?? Math.max(travelers, 1),
      rooms: body.rooms ?? 1,
    };

    const adapter = adapters[settings.provider];
    const apiKey = decryptSecret(settings.encryptedKey);

    const researched = unwrapGenerate(
      await adapter.generate(apiKey, settings.model, {
        ...transportResearchPrompt(trip, constraints.data, route.data),
        search: true,
      }),
    );
    const facts = await extractFacts(researched.text, researched.grounding, new Date());

    const stageItems = collectStageItems(base.data, route.data, days.data);
    const structured = unwrapGenerate(
      await adapter.generate(apiKey, settings.model, {
        ...budgetStructurePrompt(stageItems, facts, constraints.data, inputs),
        json: true,
      }),
    );

    let proposal;
    try {
      proposal = budgetProposalSchema.parse(JSON.parse(structured.text));
    } catch {
      throw new HttpError(502, 'The AI provider returned a malformed budget');
    }

    const built = buildBudgetContent({
      proposal,
      stageItems,
      facts,
      searchQueries: researched.grounding?.queries ?? [],
      inputs,
      assumptions: [
        `${inputs.people} pessoa(s) e ${inputs.rooms} quarto(s), conforme informado ou cadastrado`,
        'Só entram preços verificados (link, data e moeda) na moeda do orçamento; não há conversão de moedas',
        'Ingressos contam apenas as atrações agendadas como prioridade; refeições, apenas a planejada de cada dia',
      ],
      source: { daysStageId: daysStage.id, daysVersion: daysStage.version },
    });

    // Decisions are written after the risks exist, so they can refer to the real numbers.
    let decisions = new Map<string, string>();
    if (built.risks.length > 0) {
      const withoutDecisions = built.risks.map((risk) => ({ ...risk, decision: null }));
      const answered = unwrapGenerate(
        await adapter.generate(apiKey, settings.model, {
          ...decisionsPrompt(withoutDecisions, inputs, constraints.data),
          json: true,
        }),
      );

      try {
        decisions = new Map(decisionsSchema.parse(JSON.parse(answered.text)).decisions.map((d) => [d.riskId, d.decision]));
      } catch {
        throw new HttpError(502, 'The AI provider returned malformed risk decisions');
      }
    }

    const content = {
      ...built,
      risks: built.risks.map((risk) => ({ ...risk, decision: decisions.get(risk.id) ?? null })),
    };

    const { stage, created } = await saveGenerated(trip.id, 'BUDGET', current, content);
    response.status(created ? 201 : 200).json({ stage });
  } catch (error) {
    handleError(error, response, 'Unable to generate the budget');
  }
});
