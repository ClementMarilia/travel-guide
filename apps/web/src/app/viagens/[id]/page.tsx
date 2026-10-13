import { notFound, redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/server';
import { loadMessages, loadTripState } from '@/lib/trip-state';
import TripStudio from '@/components/TripStudio';

export default async function Viagem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');

  const [state, messages] = await Promise.all([loadTripState(db, id, user.id), loadMessages(db, id)]);
  if (!state) notFound();

  return <TripStudio tripId={id} userId={user.id} initialState={state} initialMessages={messages} />;
}
