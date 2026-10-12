// Grounding links from the search tool are Google redirect URLs. A price or schedule must cite
// the page itself, so the redirect is resolved to its destination (one hop, never followed further).
const redirectHosts = () => ['vertexaisearch.cloud.google.com', process.env.GROUNDING_REDIRECT_HOST].filter(Boolean);

export type ResolvedSource = { url: string; direct: boolean };

export async function resolveSourceUrl(uri: string): Promise<ResolvedSource> {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return { url: uri, direct: false };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { url: uri, direct: false };
  }

  if (!redirectHosts().includes(parsed.host)) {
    return { url: parsed.toString(), direct: true };
  }

  try {
    const response = await fetch(parsed, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    const location = response.headers.get('location');

    if (response.status >= 300 && response.status < 400 && location) {
      const target = new URL(location, parsed);

      if (['http:', 'https:'].includes(target.protocol) && !redirectHosts().includes(target.host)) {
        return { url: target.toString(), direct: true };
      }
    }
  } catch {
    // Fall through: keep the redirect link, flagged as not direct.
  }

  return { url: uri, direct: false };
}
