import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/server';
import { rateLimit } from '@/lib/rate-limit';

const idSchema = z.string().uuid();
const form = z.object({
  display_name: z.string().trim().min(1).max(80),
  pace: z.enum(['relaxed','balanced','intense']).nullable(),
  diet: z.string().trim().max(500).nullable(),
  mobility: z.string().trim().max(1000).nullable(),
  avoid_times: z.string().trim().max(500).nullable(),
  must_have: z.string().trim().min(1).max(300),
});

async function context(id: string) {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Login necessário' }, { status: 401 }) };
  if (!idSchema.safeParse(id).success)
    return { error: NextResponse.json({ error: 'Viagem inválida' }, { status: 400 }) };
  const { data: trip } = await db.from('trips').select('id,traveler_count').eq('id', id).maybeSingle();
  if (!trip) return { error: NextResponse.json({ error: 'Viagem não encontrada' }, { status: 404 }) };
  const { data: membership } = await db.from('trip_members').select('role')
    .eq('trip_id', id).eq('user_id', user.id).maybeSingle();
  if (!membership || membership.role === 'viewer')
    return { error: NextResponse.json({ error: 'Sem permissão para editar' }, { status: 403 }) };
  return { db, user, trip };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await context(id);
  if (ctx.error) return ctx.error;
  const { db, user, trip } = ctx;
  if (!rateLimit(`companions:${user!.id}`, 12, 60_000))
    return NextResponse.json({ error: 'Muitas alterações seguidas' }, { status: 429 });
  const body = form.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Preferências inválidas' }, { status: 400 });

  const { count, error: countError } = await db!.from('travel_companions')
    .select('id', { count: 'exact', head: true }).eq('trip_id', id);
  if (countError) return NextResponse.json({ error: 'Falha na consulta' }, { status: 500 });
  if ((count ?? 0) >= trip!.traveler_count - 1)
    return NextResponse.json({ error: 'O número de acompanhantes já atingiu o limite da viagem' }, { status: 409 });

  const { error } = await db!.from('travel_companions').insert({ trip_id: id, ...body.data });
  if (error) return NextResponse.json({ error: 'Não foi possível salvar o acompanhante' }, { status: 403 });

  // Reabre preferências aprovadas e invalida etapas dependentes.
  const { data: stage } = await db!.from('trip_stages').select('status')
    .eq('trip_id', id).eq('stage', 'travelers').maybeSingle();
  if (stage?.status === 'approved') {
    const { error: reopenError } = await db!.rpc('reopen_stage', { p_trip: id, p_stage: 'travelers' });
    if (reopenError) return NextResponse.json({ error: 'Dados salvos, mas falhou a reabertura da etapa' }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await context(id);
  if (ctx.error) return ctx.error;
  const parsed = z.object({ companionId: idSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Acompanhante inválido' }, { status: 400 });
  const { data, error } = await ctx.db!.from('travel_companions').delete().eq('trip_id', id)
    .eq('id', parsed.data.companionId).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: 'Erro ao excluir acompanhante' }, { status: 403 });
  if (!data) return NextResponse.json({ error: 'Acompanhante não encontrado' }, { status: 404 });
  const { data: stage } = await ctx.db!.from('trip_stages').select('status')
    .eq('trip_id', id).eq('stage', 'travelers').maybeSingle();
  if (stage?.status === 'approved') {
    const { error: reopenError } = await ctx.db!.rpc('reopen_stage', { p_trip: id, p_stage: 'travelers' });
    if (reopenError) return NextResponse.json({ error: 'Exclusão salva, mas falhou a reabertura da etapa' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
