'use client';

import { useState } from 'react';

type Attraction = { id: number; name: string; sourceUrl: string };
type SearchResult = { results: Attraction[]; consultedAt: string; sourceName: string; limitations: string };

export default function AttractionsResearch({ tripId }: { tripId: string }) {
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function search() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/trips/${tripId}/attractions`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Não foi possível consultar a fonte');
      setResult(body as SearchResult);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Falha de conexão');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card section" aria-label="Pesquisa de atrações">
      <div className="kicker">Etapa 5 · Pesquisa preliminar</div>
      <h3>Descobrir atrações</h3>
      <p>Consulte referências externas antes de montar o roteiro. Os resultados são sugestões para investigar, não atrações já validadas para suas datas.</p>
      <button className="btn secondary" type="button" onClick={() => void search()} disabled={loading}>
        {loading ? 'Pesquisando…' : result ? 'Pesquisar novamente' : 'Pesquisar atrações'}
      </button>
      {result && (
        <>
          <p className="note">Fonte: {result.sourceName} · Consulta: {new Date(result.consultedAt).toLocaleString('pt-BR')}</p>
          <p className="note">{result.limitations}</p>
          {result.results.length === 0 ? (
            <p>Nenhum artigo correspondente encontrado. Não há resultados inventados.</p>
          ) : (
            <ul className="tips">
              {result.results.map(a => (
                <li key={a.id}>
                  <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">{a.name} ↗</a>
                  <div className="muted">Artigo de referência · Horários, valores e acessibilidade não verificados</div>
                </li>
              ))}
            </ul>
          )}
          <p className="note">A pesquisa não é salva no roteiro. A seleção e verificação individual serão implementadas no próximo incremento.</p>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
