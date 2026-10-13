// Limitador em memória (janela deslizante). Vale por instância do servidor:
// em ambiente serverless é uma proteção parcial; para produção, use um
// armazenamento compartilhado (ex.: Upstash Redis).
const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
