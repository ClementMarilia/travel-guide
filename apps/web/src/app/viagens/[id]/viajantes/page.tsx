import { notFound, redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/server';
import PreferenceForm from '@/components/PreferenceForm';
import StageApproval from '@/components/StageApproval';
import type { StageStatus } from '@/lib/stages';

export default async function Viajantes({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');

  const { data: trip } = await db.from('trips').select('id,destination,owner_id').eq('id', id).maybeSingle();
  if (!trip) notFound();

  const [{ data: pref }, { data: stage }] = await Promise.all([
    db.from('traveler_preferences').select('*').eq('trip_id', id).eq('user_id', user.id).maybeSingle(),
    db.from('trip_stages').select('status').eq('trip_id', id).eq('stage', 'travelers').maybeSingle(),
  ]);
  const status = (stage?.status ?? 'in_progress') as StageStatus;
  const label =
    (user.user_metadata?.full_name as string | undefined) ?? user.email?.split('@')[0] ?? 'Viajante';

  return (
    <main>
      <span className="step">Etapa 2 de 7</span>
      <h1>Preferências: {trip.destination}</h1>
      <p className="muted">Registre restrições e prioridades. A IA ajudará a organizar antes de avançar.</p>
      <PreferenceForm tripId={id} label={label} stageStatus={status} initial={pref} />
      <StageApproval tripId={id} stage="travelers" status={status} isOwner={trip.owner_id === user.id} />
    </main>
  );
}
