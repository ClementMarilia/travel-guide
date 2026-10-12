import type { AiProviderAdapter, GenerateResult, Grounding } from './provider.js';

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
          ...(request.search && { tools: [{ google_search: {} }] }),
          generationConfig: request.json ? { responseMimeType: 'application/json' } : {},
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        // A 400 on a search request usually means search is not available for this key, model or plan.
        if (request.search && response.status === 400) {
          return { ok: false, reason: 'SEARCH_UNAVAILABLE' };
        }

        return { ok: false, reason: reasonForStatus(response.status) };
      }

      const body = (await response.json()) as {
        candidates?: {
          content?: { parts?: { text?: string }[] };
          groundingMetadata?: {
            webSearchQueries?: string[];
            groundingChunks?: { web?: { uri?: string; title?: string } }[];
            groundingSupports?: {
              segment?: { startIndex?: number; endIndex?: number };
              groundingChunkIndices?: number[];
            }[];
          };
        }[];
      };
      const text = (body.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')
        .trim();

      if (!text) {
        return { ok: false, reason: 'EMPTY_RESPONSE' };
      }

      const metadata = body.candidates?.[0]?.groundingMetadata;
      const grounding: Grounding | undefined = metadata && {
        queries: metadata.webSearchQueries ?? [],
        chunks: (metadata.groundingChunks ?? []).map((chunk) => ({
          uri: chunk.web?.uri ?? '',
          title: chunk.web?.title ?? '',
        })),
        supports: (metadata.groundingSupports ?? []).map((support) => ({
          start: support.segment?.startIndex ?? 0,
          end: support.segment?.endIndex ?? 0,
          chunkIndices: support.groundingChunkIndices ?? [],
        })),
      };

      return { ok: true, text, grounding };
    } catch {
      return { ok: false, reason: 'UNREACHABLE' };
    }
  },
};
