import Link from 'next/link';
export default function Home() {
  return (
    <main className="hero">
      <span className="step">PLANEJAMENTO INTELIGENTE</span>
      <h1>Sua viagem, suas regras. A IA organiza o resto.</h1>
      <p className="muted">
        Defina o destino, registre preferências e aprove cada etapa do planejamento. Sem roteiros impossíveis.
      </p>
      <p>
        <Link href="/viagens/nova" className="btn">
          Começar minha viagem →
        </Link>{' '}
        <Link href="/dashboard" className="btn secondary">
          Ver minhas viagens
        </Link>
      </p>
      <section className="grid topspace">
        {['1. Defina destino e datas', '2. Conte suas preferências', '3. Aprove cada decisão'].map((t) => (
          <div key={t} className="panel">
            <h3>{t}</h3>
          </div>
        ))}
      </section>
    </main>
  );
}
