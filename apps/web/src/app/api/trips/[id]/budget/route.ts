import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/server';
import { rateLimit } from '@/lib/rate-limit';
import { loadTripState } from '@/lib/trip-state';
import { resolveUserModel } from '@/lib/ai-model';
import { generateStructured, GeminiError } from '@/lib/gemini';
import { ESTIMATE_SCHEMA, ESTIMATE_SYSTEM, estimatePrompt, parseEstimate } from '@/lib/budget-ai';
import { CATEGORIES, defaultAllocation, lodgingEstimate, nightsBetween } from '@/lib/budget';

// Tempo máximo da função (a chamada ao Gemini pode levar dezenas de segundos).
export const maxDuration = 60;

const AI_SOURCE = 'Estimativa da IA (não verificada)';

/** Calcula as faixas de custo da viagem e grava os itens do orçamento, preservando o que a pessoa já planejou. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login necessário' }, { status: 401 });
  if (!rateLimit(`budget:${user.id}`, 4, 60_000)) {
    return NextResponse.json({ error: 'Muitas solicitações. Tente em instantes.' }, { status: 429 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Configure GEMINI_API_KEY no servidor.' }, { status: 503 });

  const state = await loadTripState(db, id, user.id);
  if (!state) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  const { trip } = state;

  if (state.stages.find((s) => s.stage === 'base')?.status !== 'approved') {
    return NextResponse.json({ error: 'Aprove a base da viagem primeiro.' }, { status: 409 });
  }
  if (trip.total_budget == null) {
    return NextResponse.json(
      { error: 'Conte o orçamento total no chat para validar a viabilidade.' },
      { status: 409 },
    );
  }
  if (!trip.start_date || !trip.end_date)
    return NextResponse.json({ error: 'Faltam as datas.' }, { status: 409 });

  const { data: region } = await db
    .from('trip_regions')
    .select('id,name,price_min,price_max,price_status,source')
    .eq('trip_id', id)
    .eq('chosen', true)
    .maybeSingle();
  if (!region) return NextResponse.json({ error: 'Nenhuma base escolhida.' }, { status: 409 });

  const nights = nightsBetween(trip.start_date, trip.end_date);

  let costs;
  try {
    const model = await resolveUserModel(db, user.id, apiKey);
    costs = parseEstimate(
      await generateStructured(
        apiKey,
        model,
        ESTIMATE_SYSTEM,
        estimatePrompt(trip, state.prefs, region.name, nights),
        ESTIMATE_SCHEMA,
      ),
    );
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 502;
    return NextResponse.json(
      { error: e instanceof GeminiError ? e.message : 'Falha ao falar com a IA' },
      { status },
    );
  }
  if (!costs)
    return NextResponse.json(
      { error: 'A IA devolveu uma estimativa inválida. Tente de novo.' },
      { status: 502 },
    );

  const lodging = lodgingEstimate(region, nights, trip.traveler_count);
  const { data: existing } = await db.from('budget_items').select('category,planned').eq('trip_id', id);
  const planned = new Map((existing ?? []).map((r) => [r.category as string, Number(r.planned)]));
  const defaults = defaultAllocation(trip.total_budget);

  const est = {
    lodging: lodging
      ? {
          min: lodging.min,
          max: lodging.max,
          status: region.price_status,
          source: region.source,
          region_id: region.id,
        }
      : {
          min: null,
          max: null,
          status: 'unavailable',
          source: 'Sem estimativa de hospedagem para a região',
          region_id: region.id,
        },
    food: { ...costs.food, status: 'estimated', source: AI_SOURCE, region_id: null },
    transport: { ...costs.transport, status: 'estimated', source: AI_SOURCE, region_id: null },
    activities: { ...costs.activities, status: 'estimated', source: AI_SOURCE, region_id: null },
    buffer: {
      min: null,
      max: null,
      status: 'estimated',
      source: 'Reserva mínima de 5% do orçamento',
      region_id: null,
    },
  } as const;

  const { error } = await db.from('budget_items').upsert(
    CATEGORIES.map((c) => ({
      trip_id: id,
      category: c,
      planned: planned.get(c) ?? defaults[c],
      est_min: est[c].min,
      est_max: est[c].max,
      status: est[c].status,
      source: est[c].source,
      region_id: est[c].region_id,
    })),
    { onConflict: 'trip_id,category' },
  );
  if (error) return NextResponse.json({ error: 'Não foi possível salvar o orçamento.' }, { status: 403 });
  return NextResponse.json({ assumptions: costs.assumptions ?? null });
}
