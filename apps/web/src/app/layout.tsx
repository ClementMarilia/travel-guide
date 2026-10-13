import './globals.css';
import Link from 'next/link';
export const metadata = {
  title: 'Travel Studio AI | Planeje no seu ritmo',
  description: 'Planejamento inteligente de viagens com aprovação por etapas',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="shell">
          <header className="nav">
            <Link href="/">
              <strong>◈ Travel Studio AI</strong>
            </Link>
            <nav>
              <Link href="/dashboard">Minhas viagens</Link>
              <Link href="/login">Entrar</Link>
            </nav>
          </header>
          {children}
          <footer className="muted topspace">MVP · Planejamento consciente, passo a passo</footer>
        </div>
      </body>
    </html>
  );
}
