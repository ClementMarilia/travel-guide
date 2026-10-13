import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/server';
import { rateLimit } from '@/lib/rate-limit';
import { fetchModels, recommendedModel } from '@/lib/models';
import { testGeminiModel } from '@/lib/gemini';

// `null` volta ao modelo recomendado.
const body = z.object({
  model: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .nullable(),
});

export async function POST(request: NextRequest) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Modelo inválido' }, { status: 400 });

  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login necessário' }, { status: 401 });
  if (!rateLimit(`model:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Muitas tentativas. Aguarde um instante.' }, { status: 429 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Configure GEMINI_API_KEY no servidor.' }, { status: 503 });

  const chosen = parsed.data.model;
  const effective = chosen ?? recommendedModel();

  // Só aceita modelos que a API realmente lista, e só salva se o teste responder.
  try {
    const allowed = await fetchModels(apiKey);
    if (!allowed.some((m) => m.id === effective)) {
      return NextResponse.json({ error: 'Esse modelo não está disponível.' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Não foi possível validar o modelo agora.' }, { status: 502 });
  }
  if (!(await testGeminiModel(apiKey, effective))) {
    return NextResponse.json(
      { error: 'O teste falhou. A configuração anterior foi mantida.' },
      { status: 502 },
    );
  }

  const { error } = await db.from('profiles').update({ ai_model: chosen }).eq('id', user.id);
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 });
  return NextResponse.json({ model: effective });
}
