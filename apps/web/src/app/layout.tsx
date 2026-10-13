import './globals.css';
import Link from 'next/link';
import { supabaseServer } from '@/lib/server';

export const metadata = {
  title: 'Travel Studio AI | Planeje no seu ritmo',
  description: 'Planejamento inteligente de viagens com aprovação por etapas',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();

  return (
    <html lang="pt-BR">
      <body>
        <header className="nav">
          <Link href="/">
            <strong>◈ Travel Studio AI</strong>
          </Link>
          <nav>
            <Link href="/dashboard">Minhas viagens</Link>
            {user ? (
              <form action="/auth/signout" method="post">
                <button className="linkbtn">Sair</button>
              </form>
            ) : (
              <Link href="/login">Entrar</Link>
            )}
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
