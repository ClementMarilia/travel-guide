import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/server';
import { rateLimit } from '@/lib/rate-limit';
import { splitUpdates } from '@/lib/chat-updates';
import { askGemini, buildSystemPrompt, GeminiError } from '@/lib/gemini';
import { loadMessages, loadTripState } from '@/lib/trip-state';
import { fetchModels, pickModel, recommendedModel } from '@/lib/models';

const body = z.object({ tripId: z.string().uuid(), message: z.string().trim().min(1).max(1000) });

const REOPENED_NOTE =
  '\n\n⚠️ Isso alterou algo que você já tinha aprovado. Revise o painel e aprove novamente.';

export async function POST(request: NextRequest) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Mensagem inválida' }, { status: 400 });
  const { tripId, message } = parsed.data;

  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login necessário' }, { status: 401 });

  if (!rateLimit(`chat:${user.id}`, 12, 60_000)) {
    return NextResponse.json({ error: 'Muitas mensagens seguidas. Tente em instantes.' }, { status: 429 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Configure GEMINI_API_KEY no servidor para ativar o chat.' },
      { status: 503 },
    );
  }

  // RLS: só membros da viagem enxergam o estado; só editores gravam.
  const state = await loadTripState(db, tripId, user.id);
  if (!state) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });

  // Modelo escolhido pela pessoa, se ainda existir; senão o recomendado.
  const { data: profile } = await db.from('profiles').select('ai_model').eq('id', user.id).maybeSingle();
  const allowed = await fetchModels(apiKey).catch(() => []);
  const model = pickModel(profile?.ai_model, allowed, recommendedModel());

  const history = await loadMessages(db, tripId, 20);
  const today = new Date().toISOString().slice(0, 10);

  let result;
  try {
    result = await askGemini(apiKey, model, buildSystemPrompt(today, state.trip, state.prefs), [
      ...history,
      { role: 'user', content: message },
    ]);
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 502;
    const error = e instanceof GeminiError ? e.message : 'Falha ao falar com a IA';
    return NextResponse.json({ error }, { status });
  }

  const { tripPatch, prefPatch } = splitUpdates(result.updates, state.trip, state.prefs);
  const status = (k: string) => state.stages.find((s) => s.stage === k)?.status;

  if (Object.keys(tripPatch).length) {
    const { error } = await db.from('trips').update(tripPatch).eq('id', tripId);
    if (error) return NextResponse.json({ error: 'Não foi possível salvar a viagem' }, { status: 403 });
  }
  if (Object.keys(prefPatch).length) {
    const label =
      (user.user_metadata?.full_name as string | undefined) ?? user.email?.split('@')[0] ?? 'Viajante';
    const { error } = await db
      .from('traveler_preferences')
      .upsert({ trip_id: tripId, user_id: user.id, label, ...prefPatch }, { onConflict: 'trip_id,user_id' });
    if (error)
      return NextResponse.json({ error: 'Não foi possível salvar as preferências' }, { status: 403 });
  }

  // Alterar algo já aprovado reabre a etapa e marca as seguintes para revisão, sem avisar em silêncio.
  let reopened = false;
  if (Object.keys(tripPatch).length && status('create_trip') === 'approved') {
    reopened = !(await db.rpc('reopen_stage', { p_trip: tripId, p_stage: 'create_trip' })).error;
  } else if (Object.keys(prefPatch).length && status('travelers') === 'approved') {
    reopened = !(await db.rpc('reopen_stage', { p_trip: tripId, p_stage: 'travelers' })).error;
  }

  const answer = reopened ? result.reply + REOPENED_NOTE : result.reply;
  await db.from('chat_messages').insert([
    { trip_id: tripId, user_id: user.id, role: 'user', content: message },
    { trip_id: tripId, user_id: user.id, role: 'assistant', content: answer },
  ]);

  return NextResponse.json({ reply: answer });
}
