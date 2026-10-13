import { z } from 'zod';

export const CURRENCIES = ['EUR', 'BRL', 'USD'] as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const list = (max: number) => z.array(text(80)).max(max);

/** Campos que a IA pode preencher a partir da conversa. Cada um é validado isoladamente. */
const FIELDS = {
  destination: text(150),
  origin_city: text(150),
  travel_party: text(150),
  traveler_count: z.number().int().min(1).max(20),
  start_date: z.string().date(),
  end_date: z.string().date(),
  interests: list(15),
  total_budget: z.number().nonnegative().max(1e9),
  currency: z.enum(CURRENCIES),
  pace: z.enum(['relaxed', 'balanced', 'intense']),
  main_transport: z.enum(['car', 'public', 'mixed']),
  diet: text(500),
  mobility: text(1000),
  avoid_times: text(500),
  must_haves: list(20),
} as const;

export type UpdateKey = keyof typeof FIELDS;
export type Updates = Partial<Record<UpdateKey, unknown>>;

/** Mantém só os campos válidos; um valor inválido da IA nunca derruba os demais. */
export function parseUpdates(raw: unknown): Updates {
  const out: Updates = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(FIELDS) as UpdateKey[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === null || value === undefined) continue;
    const parsed = FIELDS[key].safeParse(value);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

export type TripFields = {
  destination: string | null;
  origin_city: string | null;
  travel_party: string | null;
  traveler_count: number;
  start_date: string | null;
  end_date: string | null;
  interests: string[];
  total_budget: number | null;
  currency: string;
};

export type PrefFields = {
  pace: string | null;
  main_transport: string | null;
  diet: string | null;
  mobility: string | null;
  avoid_times: string | null;
  must_haves: string[];
};

const TRIP_KEYS = [
  'destination',
  'origin_city',
  'travel_party',
  'traveler_count',
  'start_date',
  'end_date',
  'interests',
  'total_budget',
  'currency',
] as const;
const PREF_KEYS = ['pace', 'main_transport', 'diet', 'mobility', 'avoid_times', 'must_haves'] as const;

/** Une listas sem repetir (ignora maiúsculas) e respeita o limite. */
export function mergeList(current: string[], additions: string[], max: number): string[] {
  const seen = new Set(current.map((s) => s.toLowerCase()));
  const out = [...current];
  for (const item of additions) {
    if (!seen.has(item.toLowerCase()) && out.length < max) {
      seen.add(item.toLowerCase());
      out.push(item);
    }
  }
  return out;
}

/**
 * Separa as atualizações em colunas de `trips` e de `traveler_preferences`,
 * guardando só o que realmente muda o estado atual.
 */
export function splitUpdates(
  updates: Updates,
  trip: TripFields,
  prefs: PrefFields | null,
): { tripPatch: Record<string, unknown>; prefPatch: Record<string, unknown> } {
  const u = { ...updates };

  // Datas incoerentes (volta antes da ida) são descartadas em conjunto.
  if (u.start_date || u.end_date) {
    const start = (u.start_date as string | undefined) ?? trip.start_date;
    const end = (u.end_date as string | undefined) ?? trip.end_date;
    if (start && end && end < start) {
      delete u.start_date;
      delete u.end_date;
    }
  }

  const tripPatch: Record<string, unknown> = {};
  for (const key of TRIP_KEYS) {
    if (!(key in u)) continue;
    if (key === 'interests') {
      const merged = mergeList(trip.interests, u.interests as string[], 15);
      if (merged.length !== trip.interests.length) tripPatch.interests = merged;
    } else if (u[key] !== trip[key]) {
      tripPatch[key] = u[key];
    }
  }
  if (tripPatch.destination) tripPatch.title = `Viagem a ${tripPatch.destination}`;

  const prefPatch: Record<string, unknown> = {};
  for (const key of PREF_KEYS) {
    if (!(key in u)) continue;
    if (key === 'must_haves') {
      const current = prefs?.must_haves ?? [];
      const merged = mergeList(current, u.must_haves as string[], 20);
      if (merged.length !== current.length) prefPatch.must_haves = merged;
    } else if (u[key] !== (prefs?.[key] ?? null)) {
      prefPatch[key] = u[key];
    }
  }

  return { tripPatch, prefPatch };
}
