import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { fetchPage, isBlockedAddress } from '../../src/lib/page-fetch.js';

describe('isBlockedAddress', () => {
  it('blocks private, loopback, link-local and reserved addresses', () => {
    for (const address of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1',
      '::ffff:127.0.0.1', '::ffff:169.254.169.254', 'not-an-ip',
    ]) {
      assert.equal(isBlockedAddress(address), true, `${address} must be blocked`);
    }
  });

  it('allows public addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      assert.equal(isBlockedAddress(address), false, `${address} must be allowed`);
    }
  });
});

describe('fetchPage', () => {
  let server: http.Server;
  let base: string;
  let privateOnly: http.Server;
  let privateBase: string;
  const originalAllow = process.env.VERIFY_ALLOW_HOSTS;

  before(async () => {
    privateOnly = http.createServer((_req, res) => res.end('secret internal page')).listen(0, '127.0.0.1');
    await new Promise((resolve) => privateOnly.once('listening', resolve));
    privateBase = `http://127.0.0.1:${(privateOnly.address() as AddressInfo).port}`;

    server = http
      .createServer((req, res) => {
        switch (req.url) {
          case '/ok':
            return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<p>Olá, preço 15 EUR</p>');
          case '/json':
            return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"price":15}');
          case '/pdf':
            return void res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-1.4');
          case '/forbidden':
            return void res.writeHead(403).end('no');
          case '/redirect-ok':
            return void res.writeHead(302, { location: '/ok' }).end();
          case '/redirect-private':
            return void res.writeHead(302, { location: `${privateBase}/` }).end();
          case '/loop':
            return void res.writeHead(302, { location: '/loop' }).end();
          case '/big':
            return void res.writeHead(200, { 'content-type': 'text/html' }).end('x'.repeat(5_000_000));
          default:
            return void res.writeHead(404).end('nope');
        }
      })
      .listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Only this one test server is allowed; the other private server stays blocked.
    process.env.VERIFY_ALLOW_HOSTS = base.replace('http://', '');
  });

  after(() => {
    server.close();
    privateOnly.close();
    if (originalAllow === undefined) delete process.env.VERIFY_ALLOW_HOSTS;
    else process.env.VERIFY_ALLOW_HOSTS = originalAllow;
  });

  it('downloads an allowed page, following a redirect', async () => {
    const result = await fetchPage(`${base}/redirect-ok`);

    assert.ok(result.ok);
    assert.match(result.body, /preço 15 EUR/);
    assert.equal(result.finalUrl, `${base}/ok`);
  });

  it('reads JSON but refuses non-text content', async () => {
    assert.equal((await fetchPage(`${base}/json`)).ok, true);

    const pdf = await fetchPage(`${base}/pdf`);
    assert.ok(!pdf.ok);
    assert.equal(pdf.reason, 'NOT_TEXT');
  });

  it('reports HTTP errors with their status', async () => {
    const forbidden = await fetchPage(`${base}/forbidden`);
    assert.ok(!forbidden.ok && forbidden.reason === 'HTTP_ERROR');
    assert.equal(forbidden.status, 403);

    const missing = await fetchPage(`${base}/missing`);
    assert.ok(!missing.ok && missing.reason === 'HTTP_ERROR');
    assert.equal(missing.status, 404);
  });

  it('blocks internal addresses that are not allow-listed, including by redirect', async () => {
    for (const url of [
      `${privateBase}/`,
      'http://127.0.0.1:1/',
      'http://localhost:1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]:80/',
      'http://[::ffff:127.0.0.1]/',
      'http://0.0.0.0/',
      `${base}/redirect-private`,
    ]) {
      const result = await fetchPage(url);
      assert.ok(!result.ok && result.reason === 'BLOCKED_HOST', `${url} must be blocked`);
    }
  });

  it('only fetches http(s) links', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com']) {
      const result = await fetchPage(url);
      assert.ok(!result.ok && result.reason === 'BLOCKED_HOST', `${url} must be refused`);
    }

    const invalid = await fetchPage('not a url');
    assert.ok(!invalid.ok && invalid.reason === 'UNREACHABLE');
  });

  it('gives up on redirect loops and truncates very large pages', async () => {
    const loop = await fetchPage(`${base}/loop`);
    assert.ok(!loop.ok && loop.reason === 'UNREACHABLE');

    const big = await fetchPage(`${base}/big`);
    assert.ok(big.ok);
    assert.ok(big.body.length <= 2_000_000);
  });
});
