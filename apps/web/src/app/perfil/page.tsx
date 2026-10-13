import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/server';
import AiSettings from '@/components/AiSettings';

export default async function Perfil() {
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await db.from('profiles').select('ai_model').eq('id', user.id).maybeSingle();

  return (
    <main className="container">
      <h1>Perfil</h1>
      <p className="muted">{user.email}</p>
      <AiSettings initialModel={profile?.ai_model ?? null} />
    </main>
  );
}
