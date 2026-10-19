import Link from 'next/link';
import { createQuickTrip } from './actions';

const features = [
  ['01', 'Conte seus planos', 'Origem, destino, datas, companhia e limite financeiro.'],
  ['02', 'Escolha o caminho', 'Compare opções e revise estimativas com transparência.'],
  ['03', 'Aprove seu roteiro', 'Cada decisão fica com você; a IA organiza as alternativas.'],
];

export default function Home() {
  return (
    <main className="landing">
      <div className="landing-orbit" aria-hidden="true" />
      <section className="landing-grid container">
        <div className="landing-copy">
          <span className="landing-eyebrow">SEU ESTÚDIO DE VIAGENS • 100% ONLINE</span>
          <h1>Uma viagem incrível começa com <em>um plano simples.</em></h1>
          <p>De onde você sai? Para onde quer ir? Você define o orçamento e o ritmo. O Travel Studio AI ajuda a organizar o resto — sem surpresas e sem reservas obrigatórias.</p>
          <div className="landing-trust"><span>✓ Planejamento personalizado</span><span>✓ Decisões sob seu controle</span><span>✓ No seu celular</span></div>
          <Link href="/dashboard" className="landing-text-link">Já tem viagens? Abrir meu painel →</Link>
        </div>
        <form className="planner-card" action={createQuickTrip}>
          <div className="planner-card-head"><span className="landing-eyebrow">PLANEJE AGORA</span><h2>Para onde vamos?</h2><p>Preencha o básico e continue no seu painel.</p></div>
          <div className="planner-two">
            <label>Saindo de<input name="origin" placeholder="Ex.: Treviso, Itália" required minLength={2} maxLength={120} autoComplete="off"/></label>
            <label>Destino<input name="destination" placeholder="Ex.: Ljubljana, Eslovênia" required minLength={2} maxLength={120} autoComplete="off"/></label>
            <label>Data de ida<input name="startDate" type="date" required/></label>
            <label>Data de volta<input name="endDate" type="date" required/></label>
            <label>Viajantes<input name="travelers" type="number" min={1} max={30} defaultValue={2} required/></label>
            <label>Transporte<select name="transport" defaultValue="mixed"><option value="mixed">Quero comparar</option><option value="plane">Avião</option><option value="car">Carro</option><option value="train">Trem</option><option value="bus">Ônibus</option></select></label>
            <label>Orçamento total<input name="budget" type="number" min="1" step="0.01" placeholder="Ex.: 600" required/></label>
            <label>Moeda<select name="currency" defaultValue="EUR"><option value="EUR">EUR — €</option><option value="BRL">BRL — R$</option><option value="USD">USD — $</option><option value="GBP">GBP — £</option></select></label>
          </div>
          <button type="submit" className="planner-submit">Criar minha viagem <span aria-hidden="true">→</span></button>
          <p className="planner-disclaimer">Seus dados são salvos na sua conta. Valores e disponibilidade só serão considerados verificados quando houver fonte confiável.</p>
        </form>
      </section>
      <section className="landing-features container" aria-label="Como funciona">
        {features.map(([n,title,desc]) => <article className="landing-feature" key={n}><span>{n}</span><h3>{title}</h3><p>{desc}</p></article>)}
      </section>
    </main>
  );
}
