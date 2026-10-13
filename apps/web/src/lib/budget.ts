// Motor de orçamento: cálculo determinístico. A IA só fornece faixas estimadas;
// a avaliação nunca "reduz" custos para a viagem parecer viável.

export const CATEGORIES = ['lodging', 'food', 'transport', 'activities', 'buffer'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  lodging: 'Hospedagem',
  food: 'Alimentação',
  transport: 'Transporte',
  activities: 'Atrações',
  buffer: 'Reserva para imprevistos',
};

export type PriceStatus = 'confirmed' | 'estimated' | 'unavailable';
export const PRICE_STATUS_LABEL: Record<PriceStatus, string> = {
  confirmed: 'Confirmado',
  estimated: 'Estimado',
  unavailable: 'Indisponível',
};

/** Parte do orçamento total reservada para imprevistos. */
export const BUFFER_SHARE = 0.05;

const SHARE: Record<Category, number> = {
  lodging: 0.44,
  food: 0.24,
  transport: 0.14,
  activities: 0.12,
  buffer: 0.06,
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** Distribuição inicial do orçamento; a última categoria absorve o arredondamento. */
export function defaultAllocation(total: number): Record<Category, number> {
  const out = {} as Record<Category, number>;
  let used = 0;
  CATEGORIES.slice(0, -1).forEach((c) => {
    out[c] = cents(total * SHARE[c]);
    used += out[c];
  });
  out.buffer = cents(total - used);
  return out;
}

/** Noites entre as datas (ISO). Mínimo de 1. */
export function nightsBetween(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86_400_000));
}

/** Suposição explícita: um quarto para cada duas pessoas. */
export function roomsFor(travelers: number): number {
  return Math.max(1, Math.ceil(travelers / 2));
}

export type Range = { min: number; max: number };

export function lodgingEstimate(
  region: { price_min: number | null; price_max: number | null },
  nights: number,
  travelers: number,
): Range | null {
  if (region.price_min == null || region.price_max == null) return null;
  const factor = nights * roomsFor(travelers);
  return { min: cents(region.price_min * factor), max: cents(region.price_max * factor) };
}

export type Line = { category: Category; planned: number; est: Range | null; status: PriceStatus };
export type Level = 'ok' | 'tight' | 'short' | 'unknown';
export type Verdict = 'viable' | 'tight' | 'deficit' | 'unknown';

export type Evaluation = {
  verdict: Verdict;
  plannedTotal: number;
  overAllocated: number;
  usable: number;
  needMin: number;
  needMax: number;
  deficit: number;
  missing: Category[];
  lines: { category: Category; level: Level; gap: number }[];
};

export function evaluate(total: number, lines: Line[]): Evaluation {
  const spendable = lines.filter((l) => l.category !== 'buffer');
  const withEst = spendable.filter((l) => l.est);
  const needMin = cents(withEst.reduce((s, l) => s + l.est!.min, 0));
  const needMax = cents(withEst.reduce((s, l) => s + l.est!.max, 0));
  const missing = spendable.filter((l) => !l.est).map((l) => l.category);

  // Parte do total que fica disponível depois de separar a reserva mínima.
  const usable = cents(total * (1 - BUFFER_SHARE));
  const plannedTotal = cents(lines.reduce((s, l) => s + l.planned, 0));
  const deficit = cents(Math.max(0, needMin - usable));

  let verdict: Verdict;
  if (deficit > 0)
    verdict = 'deficit'; // o mínimo já estourou, mesmo sem as categorias faltantes
  else if (missing.length) verdict = 'unknown';
  else verdict = usable < needMax ? 'tight' : 'viable';

  return {
    verdict,
    plannedTotal,
    overAllocated: cents(Math.max(0, plannedTotal - total)),
    usable,
    needMin,
    needMax,
    deficit,
    missing,
    lines: lines.map((l) => {
      if (l.category === 'buffer') {
        const minimum = cents(total * BUFFER_SHARE);
        return {
          category: l.category,
          level: l.planned >= minimum ? 'ok' : 'short',
          gap: cents(Math.max(0, minimum - l.planned)),
        };
      }
      if (!l.est) return { category: l.category, level: 'unknown', gap: 0 };
      if (l.planned >= l.est.max) return { category: l.category, level: 'ok', gap: 0 };
      if (l.planned >= l.est.min) return { category: l.category, level: 'tight', gap: 0 };
      return { category: l.category, level: 'short', gap: cents(l.est.min - l.planned) };
    }),
  };
}

export type RegionPrice = {
  name: string;
  price_min: number | null;
  price_max: number | null;
  chosen: boolean;
};

export function money(value: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
}

/** Sugestões de ajuste, todas calculadas a partir dos números (nada inventado). */
export function suggestions(
  ev: Evaluation,
  currency: string,
  nights: number,
  travelers: number,
  regions: RegionPrice[],
): string[] {
  if (ev.verdict !== 'deficit' && ev.verdict !== 'tight') return [];
  const out: string[] = [];
  const needed = ev.verdict === 'deficit' ? ev.deficit : cents(ev.needMax - ev.usable);
  const label =
    ev.verdict === 'deficit'
      ? 'Aumentar o orçamento total em pelo menos'
      : 'Para cobrir também a estimativa máxima, aumente o orçamento em';
  out.push(`${label} ${money(needed / (1 - BUFFER_SHARE), currency)}.`);

  const chosen = regions.find((r) => r.chosen);
  if (chosen?.price_min != null) {
    const cheaper = regions.filter(
      (r) => !r.chosen && r.price_min != null && r.price_min < chosen.price_min!,
    );
    for (const r of cheaper) {
      out.push(
        `Trocar a base para ${r.name}: a estimativa de hospedagem é menor (${money(r.price_min!, currency)} por noite, por quarto).`,
      );
    }
    if (nights > 1) {
      const saved = cents(chosen.price_min * roomsFor(travelers));
      out.push(`Reduzir uma noite economiza ao menos ${money(saved, currency)} em hospedagem.`);
    }
  }
  return out;
}
