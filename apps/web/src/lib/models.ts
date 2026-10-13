export type ModelInfo = { id: string; label: string };

export const FALLBACK_MODEL = 'gemini-3.8-flash';

/** Modelo recomendado pelo sistema. Pode ser trocado por variável de ambiente. */
export function recommendedModel(): string {
  return process.env.GEMINI_MODEL || FALLBACK_MODEL;
}

// Modelos que não servem para conversa de texto.
const EXCLUDED = /(embedding|tts|image|live|audio|vision|robotics|computer-use|learnlm|aqa)/i;

/** Converte a resposta de `models.list` na lista de modelos de chat utilizáveis. */
export function filterModels(raw: unknown): ModelInfo[] {
  const models = (raw as { models?: unknown })?.models;
  if (!Array.isArray(models)) return [];
  const out: ModelInfo[] = [];
  for (const m of models as Record<string, unknown>[]) {
    const name = typeof m.name === 'string' ? m.name : '';
    const id = name.replace(/^models\//, '');
    const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
    if (!id.startsWith('gemini-') || !/^[A-Za-z0-9._-]{1,64}$/.test(id)) continue;
    if (!methods.includes('generateContent') || EXCLUDED.test(id)) continue;
    out.push({ id, label: typeof m.displayName === 'string' && m.displayName ? m.displayName : id });
  }
  return out;
}

/** Recomendado primeiro; depois do mais novo para o mais antigo. */
export function sortModels(models: ModelInfo[], recommended: string): ModelInfo[] {
  return [...models].sort((a, b) => {
    if (a.id === recommended) return -1;
    if (b.id === recommended) return 1;
    return b.id.localeCompare(a.id, 'en', { numeric: true });
  });
}

/** Usa a preferência da pessoa só se o modelo ainda existir na lista. */
export function pickModel(
  preferred: string | null | undefined,
  allowed: ModelInfo[],
  fallback: string,
): string {
  return preferred && allowed.some((m) => m.id === preferred) ? preferred : fallback;
}

// Cache em memória por instância do servidor.
let cache: { at: number; models: ModelInfo[] } | null = null;
const TTL_MS = 10 * 60_000;

export async function fetchModels(apiKey: string, force = false): Promise<ModelInfo[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.models;
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Não foi possível listar os modelos');
  const models = filterModels(await response.json());
  cache = { at: Date.now(), models };
  return models;
}
