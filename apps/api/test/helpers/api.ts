/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { FAKE_GOOD_KEY, startFakeGemini, startFakeSite, type FakeGemini } from './fake-servers.js';

export type Response = { status: number; body: any };

export class Client {
  constructor(
    private readonly base: string,
    readonly token?: string,
  ) {}

  async call(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(this.token && { authorization: `Bearer ${this.token}` }) },
      body: body === undefined || method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body),
    });
    const text = await response.text();

    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  get = (path: string) => this.call('GET', path);
  post = (path: string, body: unknown = {}) => this.call('POST', path, body);
  patch = (path: string, body: unknown) => this.call('PATCH', path, body);
  put = (path: string, body: unknown) => this.call('PUT', path, body);
  delete = (path: string) => this.call('DELETE', path);

  withToken(token: string) {
    return new Client(this.base, token);
  }
}

export type TestApi = {
  anonymous: Client;
  gemini: FakeGemini;
  siteHost: string;
  newUser: (opts?: { aiKey?: string | null }) => Promise<Client>;
  newTrip: (user: Client, over?: Record<string, unknown>) => Promise<Trip>;
  stop: () => Promise<void>;
};

export class Trip {
  constructor(
    readonly user: Client,
    readonly id: string,
  ) {}

  path = (suffix = '') => `/trips/${this.id}${suffix}`;
  get = (suffix: string) => this.user.get(this.path(suffix));
  post = (suffix: string, body: unknown = {}) => this.user.post(this.path(suffix), body);
  patch = (suffix: string, body: unknown) => this.user.patch(this.path(suffix), body);

  async stage(name: string) {
    const { body } = await this.get('/stages');
    const versions = (body.stages as any[]).filter((s) => s.stage === name);
    return versions.sort((a, b) => b.version - a.version)[0];
  }

  async submit(name: string) {
    return this.post(`/stages/${(await this.stage(name)).id}/submit`);
  }

  async approve(name: string) {
    const stage = await this.stage(name);
    const submitted = await this.post(`/stages/${stage.id}/submit`);
    if (submitted.status !== 200) throw new Error(`submit ${name} -> ${submitted.status} ${JSON.stringify(submitted.body)}`);
    const approved = await this.post(`/stages/${stage.id}/approve`);
    if (approved.status !== 200) throw new Error(`approve ${name} -> ${approved.status} ${JSON.stringify(approved.body)}`);
  }

  // Edits the content of a stage with a function and saves it with PATCH.
  async edit(name: string, change: (content: any) => void) {
    const stage = await this.stage(name);
    const content = structuredClone(stage.content);
    change(content);
    return this.patch(`/stages/${stage.id}`, { content });
  }

  async runInterview() {
    await this.post('/interview/answer');
    for (const answer of ['3000 euros', 'tranquilo', 'sem restrições', 'caminhamos bem', 'nada antes das 9h']) {
      const step = await this.post('/interview/answer', { answer });
      if (step.status !== 200) throw new Error(`interview -> ${step.status} ${JSON.stringify(step.body)}`);
    }
  }
}

// Starts the real Express app on a random port against the test database, with the Gemini API and the
// web sites replaced by local fakes. Returns null when no test database is configured.
export async function startTestApi(): Promise<TestApi | null> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) return null;

  const site = await startFakeSite();
  const gemini = await startFakeGemini(site.origin);

  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    JWT_SECRET: 'test-secret',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    GEMINI_BASE_URL: gemini.origin,
    GROUNDING_REDIRECT_HOST: gemini.host,
    VERIFY_ALLOW_HOSTS: site.host,
  });

  const { app } = await import('../../src/app.js');
  const { getPrisma } = await import('../../src/lib/prisma.js');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const anonymous = new Client(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);

  return {
    anonymous,
    gemini,
    siteHost: site.host,
    async newUser({ aiKey = FAKE_GOOD_KEY } = {}) {
      const { body } = await anonymous.post('/auth/register', { email: `${randomUUID()}@test.local`, password: 'correct horse battery' });
      const user = anonymous.withToken(body.token);
      if (aiKey) await user.put('/ai/settings', { apiKey: aiKey });
      return user;
    },
    async newTrip(user, over = {}) {
      const { body } = await user.post('/trips', { title: 'Lisboa', destination: 'Lisboa', startDate: '2026-11-01', endDate: '2026-11-03', ...over });
      return new Trip(user, body.trip.id);
    },
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await gemini.close();
      await site.close();
      await getPrisma().$disconnect();
    },
  };
}
