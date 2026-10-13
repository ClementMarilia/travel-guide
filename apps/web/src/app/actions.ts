'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/server';

/** Cria uma viagem vazia; o chat a preenche. */
export async function createDraftTrip() {
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');

  const { data, error } = await db
    .from('trips')
    .insert({ owner_id: user.id, title: 'Nova viagem' })
    .select('id')
    .single();
  if (error || !data) throw new Error('Não foi possível criar a viagem');
  redirect(`/viagens/${data.id}`);
}
