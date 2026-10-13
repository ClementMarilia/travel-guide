import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/server';

export async function POST(request: NextRequest) {
  const db = await supabaseServer();
  await db.auth.signOut();
  return NextResponse.redirect(new URL('/', request.url), 303);
}
