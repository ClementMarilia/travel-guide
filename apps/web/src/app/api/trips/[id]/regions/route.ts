import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/server';
import { rateLimit } from '@/lib/rate-limit';
import { loadTripState } from '@/lib/trip-state';
import { resolveUserModel } from '@/lib/ai-model';
import { generateStructured, GeminiError } from '@/lib/gemini';
import { REGIONS_SCHEMA, REGIONS_SYSTEM, parseRegions, regionsPrompt } from '@/lib/regions';
import { nightsBetween } from '@/lib/budget';

/** Gera até 3 regiões candidatas. Só depois de a viagem e as preferências estarem aprovadas. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login necessário' }, { status: 401 });
  if (!rateLimit(`regions:${user.id}`, 4, 60_000)) {
    return NextResponse.json({ error: 'Muitas solicitações. Tente em instantes.' }, { status: 429 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Configure GEMINI_API_KEY no servidor.' }, { status: 503 });

  const state = await loadTripState(db, id, user.id);
  if (!state) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });

  const approved = (k: string) => state.stages.find((s) => s.stage === k)?.status === 'approved';
  if (!approved('create_trip') || !approved('travelers')) {
    return NextResponse.json(
      { error: 'Aprove os dados da viagem e as preferências primeiro.' },
      { status: 409 },
    );
  }
  const { trip } = state;
  if (!trip.destination || !trip.start_date || !trip.end_date) {
    return NextResponse.json({ error: 'Faltam destino e datas.' }, { status: 409 });
  }

  let suggestions;
  try {
    const model = await resolveUserModel(db, user.id, apiKey);
    const raw = await generateStructured(
      apiKey,
      model,
      REGIONS_SYSTEM,
      regionsPrompt(trip, state.prefs, nightsBetween(trip.start_date, trip.end_date)),
      REGIONS_SCHEMA,
    );
    suggestions = parseRegions(raw);
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 502;
    return NextResponse.json(
      { error: e instanceof GeminiError ? e.message : 'Falha ao falar com a IA' },
      { status },
    );
  }
  if (!suggestions.length) {
    return NextResponse.json(
      { error: 'A IA não conseguiu sugerir regiões confiáveis. Tente de novo.' },
      { status: 502 },
    );
  }

  // Substitui apenas as sugestões ainda não escolhidas; a base escolhida nunca muda em silêncio.
  await db.from('trip_regions').delete().eq('trip_id', id).eq('chosen', false);
  const { error } = await db.from('trip_regions').insert(
    suggestions.map((r) => ({
      trip_id: id,
      name: r.name,
      summary: r.summary,
      pros: r.pros,
      cons: r.cons,
      access: r.access ?? null,
      walkability: r.walkability ?? null,
      parking: r.parking ?? null,
      fit: r.fit ?? null,
      price_min: r.price_min ?? null,
      price_max: r.price_max ?? null,
      price_status: r.price_min == null ? 'unavailable' : 'estimated',
    })),
  );
  if (error) return NextResponse.json({ error: 'Não foi possível salvar as regiões.' }, { status: 403 });
  return NextResponse.json({ count: suggestions.length });
}
