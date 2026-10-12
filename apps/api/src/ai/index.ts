import { geminiAdapter } from './gemini.js';
import type { AiProviderAdapter } from './provider.js';

export const adapters: Record<'GEMINI', AiProviderAdapter> = {
  GEMINI: geminiAdapter,
};

export { DEFAULT_GEMINI_MODEL } from './gemini.js';
