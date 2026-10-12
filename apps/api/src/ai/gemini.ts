import type { AiProviderAdapter } from './provider.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export const geminiAdapter: AiProviderAdapter = {
  async testConnection(apiKey, model) {
    try {
      // The key goes in a header, never in the URL, so it cannot leak through logs.
      const response = await fetch(`${BASE_URL}/models/${encodeURIComponent(model)}`, {
        headers: { 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        return { ok: true };
      }

      if (response.status === 404) {
        return { ok: false, reason: 'MODEL_NOT_FOUND' };
      }

      if (response.status === 429) {
        return { ok: false, reason: 'RATE_LIMITED' };
      }

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return { ok: false, reason: 'INVALID_KEY' };
      }

      return { ok: false, reason: 'UNREACHABLE' };
    } catch {
      return { ok: false, reason: 'UNREACHABLE' };
    }
  },
};
