import type { SupabaseClient } from '@supabase/supabase-js';
import type { StageRow } from './stages';
import type { PrefFields, TripFields } from './chat-updates';

export type Trip = TripFields & { id: string; owner_id: string; title: string };
export type TripState = { trip: Trip; prefs: PrefFields | null; stages: StageRow[] };
export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string };

const TRIP_COLUMNS =
  'id,owner_id,title,destination,origin_city,travel_party,traveler_count,start_date,end_date,interests,total_budget,currency';
const PREF_COLUMNS = 'pace,main_transport,diet,mobility,avoid_times,must_haves';

/** Lê tudo sob RLS: só devolve algo se o usuário for membro da viagem. */
export async function loadTripState(
  db: SupabaseClient,
  tripId: string,
  userId: string,
): Promise<TripState | null> {
  const [trip, prefs, stages] = await Promise.all([
    db.from('trips').select(TRIP_COLUMNS).eq('id', tripId).maybeSingle(),
    db
      .from('traveler_preferences')
      .select(PREF_COLUMNS)
      .eq('trip_id', tripId)
      .eq('user_id', userId)
      .maybeSingle(),
    db.from('trip_stages').select('stage,status').eq('trip_id', tripId),
  ]);
  if (!trip.data) return null;
  return {
    trip: trip.data as Trip,
    prefs: (prefs.data as PrefFields | null) ?? null,
    stages: (stages.data ?? []) as StageRow[],
  };
}

export async function loadMessages(db: SupabaseClient, tripId: string, limit = 50): Promise<ChatMessage[]> {
  const { data } = await db
    .from('chat_messages')
    .select('id,role,content,created_at')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as ChatMessage[]).reverse();
}
