'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { supabaseServer } from '@/lib/server';

const quickTripSchema = z.object({
  origin: z.string().trim().min(2).max(120),
  destination: z.string().trim().min(2).max(120),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  travelers: z.coerce.number().int().min(1).max(30),
  budget: z.coerce.number().positive().max(100000000),
  currency: z.enum(['EUR', 'BRL', 'USD', 'GBP']),
  transport: z.enum(['car', 'plane', 'train', 'bus', 'mixed']),
}).refine((v) => v.endDate >= v.startDate, { message: 'Data final anterior à inicial' });

/** Cria um rascunho e envia o usuário para a entrevista existente. */
export async function createDraftTrip() {
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  const { data, error } = await db.from('trips')
    .insert({ owner_id: user.id, title: 'Nova viagem', destination: 'A definir' })
    .select('id').single();
  if (error || !data) throw new Error('Não foi possível criar a viagem');
  redirect(`/viagens/${data.id}`);
}

/** Formulário rápido: dados validados no servidor; orçamento é total da viagem. */
export async function createQuickTrip(formData: FormData) {
  const raw = {
    origin: formData.get('origin'),
    destination: formData.get('destination'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
    travelers: formData.get('travelers'),
    budget: formData.get('budget'),
    currency: formData.get('currency'),
    transport: formData.get('transport'),
  };
  const result = quickTripSchema.safeParse(raw);
  if (!result.success) throw new Error('Confira os dados da viagem.');
  const value = result.data;
  const db = await supabaseServer();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');
  const { data, error } = await db.from('trips').insert({
    owner_id: user.id,
    title: `${value.origin} → ${value.destination}`,
    origin_city: value.origin,
    destination: value.destination,
    start_date: value.startDate,
    end_date: value.endDate,
    traveler_count: value.travelers,
    total_budget: value.budget,
    currency: value.currency,
    notes: `Meio de transporte preferido: ${value.transport}. Informação informada pelo viajante; ainda não pesquisada ou validada.`,
  }).select('id').single();
  if (error || !data) throw new Error('Não foi possível salvar a viagem.');
  redirect(`/viagens/${data.id}`);
}
