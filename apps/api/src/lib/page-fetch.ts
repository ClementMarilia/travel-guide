import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

// Downloads a public web page for verification. The server fetches URLs it did not write itself
// (search results, links typed by users), so private and internal addresses are refused at connect
// time, which also covers redirects and DNS rebinding.

export type PageResult =
  | { ok: true; status: number; finalUrl: string; body: string }
  | {
      ok: false;
      reason: 'BLOCKED_HOST' | 'HTTP_ERROR' | 'NOT_TEXT' | 'UNREACHABLE';
      status?: number;
      detail: string;
    };

const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 10_000;
const TEXT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain', 'application/json', 'application/ld+json'];

const blocked = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('ff00::', 8, 'ipv6');

export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isBlockedAddress(mapped[1]!);

  const family = net.isIP(address);
  return family === 0 ? true : blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

// Testing only: comma-separated host:port pairs that may be reached even though they are private.
function isAllowListed(url: URL) {
  const allowed = (process.env.VERIFY_ALLOW_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  return allowed.includes(url.host);
}

const safeLookup = ((hostname, options, callback) => {
  dns.lookup(hostname, { all: true, family: options.family, hints: options.hints }, (error, addresses) => {
    if (error) return callback(error, '', 4);
    if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(new Error('BLOCKED_HOST'), '', 4);
    }
    return options.all
      ? (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses)
      : callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}) as net.LookupFunction;

type Raw = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

function requestOnce(url: URL, allowPrivate: boolean): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      {
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          'user-agent': 'TravelGuideVerifier/0.1 (+price and schedule check)',
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8',
          'accept-encoding': 'identity',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
        lookup: allowPrivate ? undefined : safeLookup,
        timeout: TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;

        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= MAX_BYTES) chunks.push(chunk);
          else response.destroy();
        });
        const done = () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) });
        response.on('end', done);
        response.on('close', done);
        response.on('error', reject);
      },
    );

    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end();
  });
}

export async function fetchPage(rawUrl: string): Promise<PageResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'UNREACHABLE', detail: 'Link inválido' };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { ok: false, reason: 'BLOCKED_HOST', detail: 'Só links http(s) são conferidos' };
    }

    const allowPrivate = isAllowListed(url);
    const literal = net.isIP(url.hostname.replace(/^\[|\]$/g, ''));
    if (!allowPrivate && literal && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
      return { ok: false, reason: 'BLOCKED_HOST', detail: 'Endereço interno bloqueado por segurança' };
    }

    let raw: Raw;
    try {
      raw = await requestOnce(url, allowPrivate);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      return message.includes('BLOCKED_HOST')
        ? { ok: false, reason: 'BLOCKED_HOST', detail: 'Endereço interno bloqueado por segurança' }
        : { ok: false, reason: 'UNREACHABLE', detail: 'Não foi possível acessar a página' };
    }

    const location = raw.headers.location;
    if (raw.status >= 300 && raw.status < 400 && location) {
      try {
        url = new URL(location, url);
      } catch {
        return { ok: false, reason: 'UNREACHABLE', detail: 'Redirecionamento inválido' };
      }
      continue;
    }

    if (raw.status < 200 || raw.status >= 300) {
      return { ok: false, reason: 'HTTP_ERROR', status: raw.status, detail: `A página respondeu HTTP ${raw.status}` };
    }

    const contentType = String(raw.headers['content-type'] ?? '').toLowerCase();
    if (!TEXT_TYPES.some((type) => contentType.startsWith(type))) {
      return { ok: false, reason: 'NOT_TEXT', status: raw.status, detail: 'Conteúdo não textual (PDF, imagem ou outro formato)' };
    }

    const charset = /charset=([\w-]+)/.exec(contentType)?.[1] ?? 'utf-8';
    let body: string;
    try {
      body = new TextDecoder(charset).decode(raw.body);
    } catch {
      body = new TextDecoder('utf-8').decode(raw.body);
    }

    return { ok: true, status: raw.status, finalUrl: url.toString(), body };
  }

  return { ok: false, reason: 'UNREACHABLE', detail: 'Redirecionamentos demais' };
}
