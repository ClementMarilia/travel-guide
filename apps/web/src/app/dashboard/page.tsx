import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/server';
import { createDraftTrip } from '../actions';
import { STAGES, currentStage, progressPercent, type StageRow } from '@/lib/stages';
import { formatDate } from '@/lib/checklist';

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
    <main className="container">
      <h1>Minhas viagens</h1>
      <form action={createDraftTrip}>
        <button className="btn">+ Nova viagem</button>
      </form>
      {error && <p className="error">Erro ao buscar viagens: {error.message}</p>}
      {trips?.length === 0 && <p>Nenhuma viagem ainda.</p>}
      {trips?.map((t) => {
        const rows = (t.trip_stages ?? []) as StageRow[];
        const current = currentStage(rows);
        const label = STAGES.find((s) => s.key === current)?.label ?? 'Concluída';
        const dates =
          t.start_date && t.end_date
            ? `${formatDate(t.start_date)} a ${formatDate(t.end_date)}`
            : 'datas a definir';
        const budget =
          t.total_budget != null
            ? ` · ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: t.currency }).format(t.total_budget)}`
            : '';
        return (
          <Link key={t.id} className="cardlink" href={`/viagens/${t.id}`}>
            <strong>{t.destination ?? 'Nova viagem'}</strong>
            <div className="muted">
              {dates}
              {budget}
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
