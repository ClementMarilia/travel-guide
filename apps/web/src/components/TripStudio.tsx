'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import SidePanel from './SidePanel';
import { supabaseBrowser } from '@/lib/supabase';
import { loadTripState, type ChatMessage, type TripState } from '@/lib/trip-state';

const GREETING =
  'Oi! Vou te ajudar a montar sua viagem. Para onde você quer ir? Se ainda não sabe, me conta o que você curte e eu te dou ideias.';

export default function TripStudio({
  tripId,
  userId,
  initialState,
  initialMessages,
}: {
  tripId: string;
  userId: string;
  initialState: TripState;
  initialMessages: ChatMessage[];
}) {
  const [state, setState] = useState(initialState);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'chat' | 'panel'>('chat');
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const next = await loadTripState(supabaseBrowser(), tripId, userId);
    if (next) setState(next);
  }, [tripId, userId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, sending]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setError('');
    setSending(true);
    setInput('');
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: text }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tripId, message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar');
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: 'assistant', content: data.reply }]);
      await refresh();
    } catch (err) {
      // Devolve o texto para a caixa e remove a bolha que não foi salva.
      setMessages((m) => m.slice(0, -1));
      setInput(text);
      setError(err instanceof Error ? err.message : 'Falha ao enviar');
    }
    setSending(false);
  }

  const shown: ChatMessage[] = messages.length
    ? messages
    : [{ id: 'greeting', role: 'assistant', content: GREETING }];

  return (
    <div className="studio" data-tab={tab}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
          Conversa
        </button>
        <button role="tab" aria-selected={tab === 'panel'} onClick={() => setTab('panel')}>
          Minha viagem
        </button>
      </div>

      <section className="chat" aria-label="Conversa com a assistente">
        <div className="chat-log" ref={logRef} aria-live="polite">
          {shown.map((m) => (
            <div key={m.id} className={`bubble ${m.role}`}>
              {m.content}
            </div>
          ))}
          {sending && <div className="typing">A assistente está pensando…</div>}
        </div>
        <p className="error" role="alert" style={{ margin: '0 24px' }}>
          {error}
        </p>
        <form className="composer" onSubmit={send}>
          <textarea
            rows={2}
            value={input}
            maxLength={1000}
            placeholder="Pergunte qualquer coisa…"
            aria-label="Mensagem"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) send(e);
            }}
          />
          <button className="send" disabled={sending || !input.trim()} aria-label="Enviar">
            ↑
          </button>
        </form>
        <p className="disclaimer">Assistente com IA. Confira as informações importantes antes de reservar.</p>
      </section>

      <SidePanel tripId={tripId} state={state} isOwner={state.trip.owner_id === userId} onChanged={refresh} />
    </div>
  );
}
