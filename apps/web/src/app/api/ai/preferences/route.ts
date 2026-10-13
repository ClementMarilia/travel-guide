import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/server';
import { rateLimit } from '@/lib/rate-limit';

const body = z.object({ tripId: z.string().uuid() });

const SYSTEM_PROMPT =
  'Você é analista de preferências de viagens. Resuma em português: exigências obrigatórias, ' +
  'desejos flexíveis, possíveis conflitos e pontos a confirmar. Não invente dados, preços ou ' +
  'disponibilidade. Não crie roteiro. Não declare aprovação.';

export async function POST(request: NextRequest) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Viagem inválida' }, { status: 400 });

  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login necessário' }, { status: 401 });

  if (!rateLimit(`ai:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Muitas solicitações. Tente em instantes.' }, { status: 429 });
  }

  // A RLS garante que só membros da viagem enxergam estes dados.
  const { data: trip } = await db
    .from('trips')
    .select('id,destination')
    .eq('id', parsed.data.tripId)
    .maybeSingle();
  if (!trip) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });

  const { data: preferences } = await db
    .from('traveler_preferences')
    .select('label,pace,main_transport,diet,mobility,avoid_times,must_haves')
    .eq('trip_id', trip.id);
  if (!preferences?.length) {
    return NextResponse.json({ error: 'Salve preferências primeiro' }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Configure OPENAI_API_KEY no servidor para ativar o resumo.' },
      { status: 503 },
    );
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ destino: trip.destination, viajantes: preferences }) },
        ],
      }),
    });
    if (!response.ok) return NextResponse.json({ error: 'Serviço de IA indisponível' }, { status: 502 });

    const answer = await response.json();
    const summary = answer.choices?.[0]?.message?.content;
    if (typeof summary !== 'string') throw new Error('Resposta inesperada');
    return NextResponse.json({ summary });
  } catch {
    return NextResponse.json({ error: 'Falha ao gerar resumo' }, { status: 502 });
  }
}
