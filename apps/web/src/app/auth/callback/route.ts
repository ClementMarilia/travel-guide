import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/server';
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL('/login?error=callback', url.origin));
  }
  return NextResponse.redirect(new URL('/dashboard', url.origin));
}
