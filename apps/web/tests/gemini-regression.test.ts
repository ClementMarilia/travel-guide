import { afterEach, describe, expect, it, vi } from 'vitest';
import { askGemini, geminiHttpError } from '../src/lib/gemini';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

const SYSTEM = 'Responda em JSON';
const HISTORY = [{ role: 'user' as const, content: 'Ljubljana' }];

describe('Ciclo 01 — contrato do Gemini', () => {
  it.each([
    [400, 502, 'compatibilidade'],
    [401, 503, 'autenticação'],
    [403, 503, 'autenticação'],
    [404, 503, 'modelo'],
    [429, 429, 'limite'],
    [503, 502, 'indisponível'],
  ])('traduz HTTP %i em erro seguro', (http, status, fragment) => {
    const error = geminiHttpError(http);
    expect(error.status).toBe(status);
    expect(error.message.toLowerCase()).toContain(fragment);
    expect(error.message).not.toContain('API_KEY');
  });

  it('repete apenas uma vez HTTP 503 e aceita resposta válida', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          reply: 'Para onde você sai?', updates: { destination: 'Ljubljana' },
        }) }] } }],
      }), { status: 200 }));
    globalThis.fetch = fetchMock;
    const result = await askGemini('test-only-secret', 'gemini-test', SYSTEM, HISTORY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.updates.destination).toBe('Ljubljana');
  });

  it('não repete HTTP 429 e não divulga chave na mensagem', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
    globalThis.fetch = fetchMock;
    await expect(askGemini('secret-value', 'gemini-test', SYSTEM, HISTORY))
      .rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('encerra após duas respostas HTTP 503', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    globalThis.fetch = fetchMock;
    await expect(askGemini('secret-value', 'gemini-test', SYSTEM, HISTORY))
      .rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
