import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/server';
import { rateLimit } from '@/lib/rate-limit';
import { fetchModels, pickModel, recommendedModel, sortModels } from '@/lib/models';

export async function GET(request: NextRequest) {
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login necessário' }, { status: 401 });
  if (!rateLimit(`models:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Muitas solicitações. Tente em instantes.' }, { status: 429 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Configure GEMINI_API_KEY no servidor.' }, { status: 503 });

  const force = request.nextUrl.searchParams.get('refresh') === '1';
  try {
    const recommended = recommendedModel();
    const models = sortModels(await fetchModels(apiKey, force), recommended);
    const { data: profile } = await db.from('profiles').select('ai_model').eq('id', user.id).maybeSingle();
    return NextResponse.json({
      models,
      recommended,
      selected: pickModel(profile?.ai_model, models, recommended),
    });
  } catch {
    return NextResponse.json({ error: 'Não foi possível listar os modelos agora.' }, { status: 502 });
  }
}
