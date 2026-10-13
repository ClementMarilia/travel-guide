import { z } from 'zod';

export const CURRENCIES = ['EUR', 'BRL', 'USD'] as const;

export const tripInput = z
  .object({
    destination: z.string().trim().min(2, 'Informe o destino').max(150),
    origin: z.string().trim().max(150).default(''),
    start_date: z.string().date('Data de ida inválida'),
    end_date: z.string().date('Data de volta inválida'),
    travelers: z.number().int().min(1).max(20),
    budget_total: z.number().nonnegative().max(1e9),
    currency: z.enum(CURRENCIES).default('EUR'),
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: 'A data de volta não pode ser anterior à de ida',
    path: ['end_date'],
  });

export type TripInput = z.infer<typeof tripInput>;

/** Converte o formulário para as colunas da tabela `trips`. */
export function toTripRow(input: TripInput) {
  return {
    title: `Viagem a ${input.destination}`,
    destination: input.destination,
    origin_city: input.origin || null,
    start_date: input.start_date,
    end_date: input.end_date,
    traveler_count: input.travelers,
    total_budget: input.budget_total,
    currency: input.currency,
  };
}

export const preferenceInput = z.object({
  pace: z.enum(['relaxed', 'balanced', 'intense']),
  main_transport: z.enum(['car', 'public', 'mixed']),
  diet: z.string().trim().max(500),
  mobility: z.string().trim().max(1000),
  avoid_times: z.string().trim().max(500),
  must_haves: z.string().trim().max(1000),
});

export type PreferenceInput = z.infer<typeof preferenceInput>;

/** Uma exigência obrigatória por linha. */
export function parseMustHaves(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
