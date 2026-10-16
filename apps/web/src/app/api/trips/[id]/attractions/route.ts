import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/server';
import { rateLimit } from '@/lib/rate-limit';

export const maxDuration = 30;
const uuid = z.string().uuid();
type WikiPage = { title?: string; fullurl?: string; pageid?: number; ns?: number };
const safeDestination = z.string().trim().min(2).max(150);

/**
 * Descoberta de referências enciclopédicas externas.
 * Artigos retornados NÃO verificam abertura, preço, acessibilidade ou reserva.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: 'Viagem inválida' }, { status: 400 });
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Login necessário' }, { status: 401 });
  if (!rateLimit(`attractions:${user.id}`, 8, 60_000))
    return NextResponse.json({ error: 'Muitas pesquisas em sequência' }, { status: 429 });

  const { data: trip } = await db.from('trips').select('destination').eq('id', id).maybeSingle();
  if (!trip) return NextResponse.json({ error: 'Viagem não encontrada' }, { status: 404 });
  const destination = safeDestination.safeParse(trip.destination);
  if (!destination.success) return NextResponse.json({ error: 'Informe o destino primeiro' }, { status: 409 });

  const paramsWiki = new URLSearchParams({
    action: 'query', generator: 'search',
    gsrsearch: `${destination.data.replace(/["\\]/g, '')} landmarks tourist attractions`,
    gsrlimit: '8', prop: 'info', inprop: 'url', format: 'json', formatversion: '2',
  });
  try {
    const response = await fetch(`https://en.wikipedia.org/w/api.php?${paramsWiki}`, {
      headers: { 'User-Agent': 'TravelStudioAI/0.1 (travel attraction reference research)' },
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('External service unavailable');
    const payload: unknown = await response.json();
    const parsed = z.object({
      query: z.object({ pages: z.array(z.object({
        title: z.string(), fullurl: z.string().url(),
        pageid: z.number(), ns: z.number(),
      })).optional() }).optional(),
    }).safeParse(payload);
    if (!parsed.success) throw new Error('Unexpected external response');
    const pages = (parsed.data.query?.pages ?? []).filter((p: WikiPage) =>
      p.ns === 0 && p.fullurl?.startsWith('https://en.wikipedia.org/wiki/')
    );
    return NextResponse.json({
      results: pages.map(p => ({ id: p.pageid, name: p.title, sourceUrl: p.fullurl })),
      consultedAt: new Date().toISOString(),
      sourceName: 'Wikipédia (artigos de referência)',
      limitations: 'Esta pesquisa encontra artigos de referência. Horários, preços, distâncias e funcionamento NÃO foram verificados.',
    });
  } catch {
    return NextResponse.json({ error: 'Pesquisa externa indisponível. Não foram gerados resultados fictícios.' }, { status: 502 });
  }
}
