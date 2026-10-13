import Link from 'next/link';
import { createDraftTrip } from './actions';

const STEPS = [
  '1. Converse sobre a viagem',
  '2. Acompanhe o painel se preenchendo',
  '3. Aprove cada decisão',
];

export default function Home() {
  return (
    <main className="container hero">
      <span className="step">PLANEJAMENTO INTELIGENTE</span>
      <h1>Sua viagem, suas regras. A IA organiza o resto.</h1>
      <p className="muted">
        Converse com a assistente, veja o planejamento tomar forma ao lado e aprove cada etapa. Sem roteiros
        impossíveis.
      </p>
      <form action={createDraftTrip} style={{ display: 'inline' }}>
        <button className="btn">Começar minha viagem →</button>
      </form>{' '}
      <Link href="/dashboard" className="btn secondary">
        Ver minhas viagens
      </Link>
      <section className="grid topspace">
        {STEPS.map((t) => (
          <div key={t} className="panel">
            <h3>{t}</h3>
          </div>
        ))}
      </section>
    </main>
  );
}
