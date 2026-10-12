import { z } from 'zod';
import type { Grounding } from '../ai/provider.js';
import { resolveSourceUrl } from '../ai/sources.js';
import { resolvePrice } from './stages.js';

// Shared by every stage that researches with web search: facts, each tied to the sources the
// search found for that line of the answer.
export const FACT_CATEGORIES = [
  'CUSTO',
  'DESLOCAMENTO',
  'ACESSO',
  'HORARIO',
  'REGIAO',
  'RESERVA',
  'DURACAO',
  'ALIMENTACAO',
  'FILA',
  'CHUVA',
  'NAO_ENCONTRADO',
] as const;

const sourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  // false when the Google redirect link could not be resolved to the page itself.
  direct: z.boolean(),
  consultedAt: z.string(),
});

export const factSchema = z.object({
  id: z.string(),
  category: z.enum(FACT_CATEGORIES),
  text: z.string(),
  sources: z.array(sourceSchema),
});

export type Fact = z.infer<typeof factSchema>;

const factLine = /^FATO\s*\[([A-Z_]+)\]\s*(.+)$/;

// Splits the research text into facts and attaches the sources the search tied to each line.
// Grounding offsets are UTF-8 byte offsets into the response text.
export async function extractFacts(text: string, grounding: Grounding | undefined, now: Date): Promise<Fact[]> {
  const resolved = new Map<number, { url: string; direct: boolean; title: string }>();

  for (const [index, chunk] of (grounding?.chunks ?? []).entries()) {
    if (chunk.uri) {
      resolved.set(index, { ...(await resolveSourceUrl(chunk.uri)), title: chunk.title });
    }
  }

  const facts: Fact[] = [];
  let offset = 0;

  for (const line of text.split('\n')) {
    const start = offset;
    const end = start + Buffer.byteLength(line);
    offset = end + 1;

    const match = factLine.exec(line.trim());
    const category = match?.[1] as Fact['category'] | undefined;
    if (!match || !category || !FACT_CATEGORIES.includes(category)) {
      continue;
    }

    const chunkIndices = new Set<number>();
    for (const support of grounding?.supports ?? []) {
      if (support.start < end && support.end > start) {
        support.chunkIndices.forEach((i) => chunkIndices.add(i));
      }
    }

    const sources = [...chunkIndices]
      .map((i) => resolved.get(i))
      .filter((source): source is NonNullable<typeof source> => Boolean(source))
      .map((source) => ({ ...source, consultedAt: now.toISOString() }));

    facts.push({
      id: `F${facts.length + 1}`,
      category,
      text: match[2]!.trim(),
      // A "not found" fact never counts as sourced, whatever the model attached.
      sources: category === 'NAO_ENCONTRADO' ? [] : dedupeSources(sources),
    });
  }

  return facts;
}

function dedupeSources<T extends { url: string }>(sources: T[]) {
  return [...new Map(sources.map((source) => [source.url, source])).values()];
}

export function factLines(facts: Fact[]) {
  return facts
    .map((f) => `${f.id} [${f.category}] (${f.sources.length > 0 ? 'com fonte' : 'SEM FONTE'}) ${f.text}`)
    .join('\n');
}

// The model cites facts by id; ids that do not exist are dropped.
export function knownFactIds(ids: string[], byId: Map<string, Fact>) {
  return [...new Set(ids)].filter((id) => byId.has(id));
}

export function hasSource(ids: string[], byId: Map<string, Fact>) {
  return knownFactIds(ids, byId).some((id) => (byId.get(id)?.sources.length ?? 0) > 0);
}

export function unsourcedNotes(facts: Fact[]) {
  return facts.filter((f) => f.sources.length === 0).map((f) => `${f.id} sem fonte: ${f.text}`);
}

export const modelCostSchema = z.object({
  text: z.string(),
  amount: z.number().nonnegative().nullable(),
  currency: z.string().nullable(),
  factIds: z.array(z.string()),
});

export const verifiedCostSchema = z.object({
  text: z.string(),
  status: z.enum(['VERIFIED', 'NOT_VERIFIED']),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  consultedAt: z.string().nullable(),
  factIds: z.array(z.string()),
});

// A price is VERIFIED only with a direct source link, consultation date and currency;
// otherwise the amount is dropped. Prices are never invented or completed.
export function verifyCost(cost: z.infer<typeof modelCostSchema>, byId: Map<string, Fact>): z.infer<typeof verifiedCostSchema> {
  const factIds = knownFactIds(cost.factIds, byId);
  const source = factIds.flatMap((id) => byId.get(id)?.sources ?? []).find((s) => s.direct);
  const price = resolvePrice({
    amount: cost.amount ?? undefined,
    currency: cost.currency ?? undefined,
    sourceUrl: source?.url,
    consultedAt: source?.consultedAt,
  });

  return {
    text: cost.text,
    status: price.status,
    amount: price.amount,
    currency: price.currency,
    sourceUrl: price.sourceUrl,
    consultedAt: price.consultedAt instanceof Date ? price.consultedAt.toISOString() : null,
    factIds,
  };
}
