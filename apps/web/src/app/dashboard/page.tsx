import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/server';
import { STAGES, currentStage, progressPercent, type StageRow } from '@/lib/stages';

export default async function Dashboard() {
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');

  const { data: trips, error } = await db
    .from('trips')
    .select('id,destination,start_date,end_date,total_budget,currency,trip_stages(stage,status)')
    .order('created_at', { ascending: false });

  return (
    <main>
      <h1>Minhas viagens</h1>
      <Link className="btn" href="/viagens/nova">
        + Nova viagem
      </Link>
      {error && <p className="error">Erro ao buscar viagens: {error.message}</p>}
      {trips?.length === 0 && <p>Nenhuma viagem ainda.</p>}
      {trips?.map((t) => {
        const rows = (t.trip_stages ?? []) as StageRow[];
        const current = currentStage(rows);
        const label = STAGES.find((s) => s.key === current)?.label ?? 'Concluída';
        return (
          <Link key={t.id} className="cardlink" href={`/viagens/${t.id}/viajantes`}>
            <strong>{t.destination}</strong>
            <div className="muted">
              {t.start_date} a {t.end_date} · {t.total_budget} {t.currency}
            </div>
            <div className="muted">
              {progressPercent(rows)}% planejado · próxima etapa: {label}
            </div>
          </Link>
        );
      })}
    </main>
  );
}
