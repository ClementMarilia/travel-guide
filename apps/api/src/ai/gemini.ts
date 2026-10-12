import type { AiProviderAdapter, GenerateResult } from './provider.js';

// Overridable so tests can point at a local fake server.
const baseUrl = () => process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function reasonForStatus(status: number): 'INVALID_KEY' | 'MODEL_NOT_FOUND' | 'RATE_LIMITED' | 'UNREACHABLE' {
  if (status === 404) return 'MODEL_NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400 || status === 401 || status === 403) return 'INVALID_KEY';
  return 'UNREACHABLE';
}

export const geminiAdapter: AiProviderAdapter = {
  async testConnection(apiKey, model) {
    try {
      // The key goes in a header, never in the URL, so it cannot leak through logs.
      const response = await fetch(`${baseUrl()}/models/${encodeURIComponent(model)}`, {
        headers: { 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(10_000),
      });

      return response.ok ? { ok: true } : { ok: false, reason: reasonForStatus(response.status) };
    } catch {
      return { ok: false, reason: 'UNREACHABLE' };
    }
  },

  async generate(apiKey, model, request): Promise<GenerateResult> {
    try {
      const response = await fetch(`${baseUrl()}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: request.json ? { responseMimeType: 'application/json' } : {},
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        return { ok: false, reason: reasonForStatus(response.status) };
      }

      const body = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = (body.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')
        .trim();

      return text ? { ok: true, text } : { ok: false, reason: 'EMPTY_RESPONSE' };
    } catch {
      return { ok: false, reason: 'UNREACHABLE' };
    }
  },
};
