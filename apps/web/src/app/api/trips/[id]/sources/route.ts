import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/server';
import { rateLimit } from '@/lib/rate-limit';

const input = z.object({
  regionId: z.string().uuid(),
  label: z.string().trim().min(1).max(180),
  url: z.string().trim().url().max(2048).refine((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, 'Use uma URL HTTPS válida.'),
});

/** Registra referência fornecida pelo viajante, sem alegar conferência do conteúdo. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Viagem inválida.' }, { status: 400 });
  }
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login necessário.' }, { status: 401 });
  if (!rateLimit(`sources:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Muitas solicitações. Tente em instantes.' }, { status: 429 });
  }

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Título ou URL inválidos.' }, { status: 400 });
  const { regionId, label, url } = parsed.data;

  const { data: region } = await db.from('trip_regions')
    .select('id').eq('id', regionId).eq('trip_id', id).maybeSingle();
  if (!region) return NextResponse.json({ error: 'Região não encontrada.' }, { status: 404 });

  const { error } = await db.from('travel_sources').insert({
    trip_id: id,
    region_id: regionId,
    label,
    url,
    category: 'lodging',
    verification_status: 'unverified',
    checked_at: null,
    added_by: user.id,
  });
  if (error) return NextResponse.json({ error: 'Não foi possível salvar a fonte.' }, { status: 403 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
