import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { FAKE_BAD_KEY, FAKE_GOOD_KEY } from '../helpers/fake-servers.js';
import { startTestApi, type Client, type TestApi } from '../helpers/api.js';

let api: TestApi | null = null;
const skip = process.env.TEST_DATABASE_URL ? false : 'set TEST_DATABASE_URL to run the integration tests';

before(async () => {
  api = await startTestApi();
});

after(async () => {
  await api?.stop();
});

describe('authentication', { skip }, () => {
  it('registers, logs in and returns the account without the password', async () => {
    const email = `${randomUUID()}@test.local`;
    const registered = await api!.anonymous.post('/auth/register', { email: email.toUpperCase(), password: 'correct horse battery', name: 'Ana' });

    assert.equal(registered.status, 201);
    assert.equal(registered.body.user.email, email);
    assert.ok(!JSON.stringify(registered.body).includes('correct horse'));
    assert.ok(!('passwordHash' in registered.body.user));

    const login = await api!.anonymous.post('/auth/login', { email, password: 'correct horse battery' });
    assert.equal(login.status, 200);

    const me = await api!.anonymous.withToken(login.body.token).get('/auth/me');
    assert.equal(me.body.user.email, email);
  });

  it('rejects duplicate emails, short passwords, bad credentials and bad tokens', async () => {
    const email = `${randomUUID()}@test.local`;
    await api!.anonymous.post('/auth/register', { email, password: 'correct horse battery' });

    assert.equal((await api!.anonymous.post('/auth/register', { email, password: 'correct horse battery' })).status, 409);
    assert.equal((await api!.anonymous.post('/auth/register', { email: 'x@test.local', password: 'short' })).status, 400);
    assert.equal((await api!.anonymous.post('/auth/login', { email, password: 'wrong password!' })).status, 401);
    assert.equal((await api!.anonymous.post('/auth/login', { email: 'nobody@test.local', password: 'whatever12' })).status, 401);
    assert.equal((await api!.anonymous.withToken('not-a-token').get('/trips')).status, 401);
  });

  it('protects every private route', async () => {
    const id = randomUUID();

    for (const [method, path] of [
      ['GET', '/trips'], ['POST', '/trips'], ['GET', `/trips/${id}`], ['GET', `/trips/${id}/stages`],
      ['POST', `/trips/${id}/interview/answer`], ['POST', `/trips/${id}/base/generate`], ['GET', `/trips/${id}/travelers`],
      ['GET', '/ai/settings'], ['PUT', '/ai/settings'], ['POST', `/trips/${id}/verification/generate`],
    ] as const) {
      const response = await api!.anonymous.call(method, path, {});
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  });
});

describe('trips', { skip }, () => {
  let user: Client;
  before(async () => {
    user = await api!.newUser();
  });

  it('creates a trip with defaults, lists it and updates it', async () => {
    const created = await user.post('/trips', { title: ' Lisboa ' });

    assert.equal(created.status, 201);
    assert.deepEqual([created.body.trip.title, created.body.trip.currency, created.body.trip.status], ['Lisboa', 'EUR', 'PLANNING']);

    const patched = await user.patch(`/trips/${created.body.trip.id}`, { destination: 'Lisboa', currency: 'usd', status: 'UPCOMING' });
    assert.equal(patched.body.trip.currency, 'USD');
    assert.equal(patched.body.trip.status, 'UPCOMING');

    const list = await user.get('/trips');
    assert.ok(list.body.trips.some((t: { id: string }) => t.id === created.body.trip.id));
  });

  it('validates the data', async () => {
    assert.equal((await user.post('/trips', { title: '' })).status, 400);
    assert.equal((await user.post('/trips', { title: 'x', currency: 'EURO' })).status, 400);
    assert.equal((await user.post('/trips', { title: 'x', status: 'DONE' })).status, 400);
    assert.equal((await user.post('/trips', { title: 'x', startDate: '2026-11-05', endDate: '2026-11-01' })).status, 400);
    assert.equal((await user.get('/trips/not-a-uuid')).status, 400);
    assert.equal((await user.get(`/trips/${randomUUID()}`)).status, 404);
  });

  it('keeps trips private to their owner', async () => {
    const trip = await api!.newTrip(user);
    const stranger = await api!.newUser();
    const id = trip.id;

    for (const [method, path, body] of [
      ['GET', `/trips/${id}`, undefined],
      ['PATCH', `/trips/${id}`, { title: 'hijack' }],
      ['DELETE', `/trips/${id}`, undefined],
      ['GET', `/trips/${id}/stages`, undefined],
      ['POST', `/trips/${id}/stages`, { stage: 'INTERVIEW' }],
      ['GET', `/trips/${id}/travelers`, undefined],
      ['POST', `/trips/${id}/travelers`, { name: 'x', nonNegotiable: 'y' }],
      ['POST', `/trips/${id}/interview/answer`, {}],
      ['POST', `/trips/${id}/constraints/generate`, {}],
      ['POST', `/trips/${id}/base/generate`, {}],
      ['POST', `/trips/${id}/route/generate`, {}],
      ['POST', `/trips/${id}/days/generate`, {}],
      ['POST', `/trips/${id}/budget/generate`, {}],
      ['POST', `/trips/${id}/verification/generate`, {}],
    ] as const) {
      const response = await stranger.call(method, path, body);
      assert.equal(response.status, 404, `${method} ${path} must look like it does not exist`);
    }

    assert.equal((await user.get(`/trips/${id}`)).body.trip.title, 'Lisboa');
    assert.ok(!(await stranger.get('/trips')).body.trips.some((t: { id: string }) => t.id === id));
  });

  it('deletes a trip together with its stages and travelers', async () => {
    const trip = await api!.newTrip(user);
    await trip.post('/travelers', { name: 'Ele', nonNegotiable: 'x' });
    await trip.post('/stages', { stage: 'INTERVIEW' });

    assert.equal((await user.delete(trip.path())).status, 204);
    assert.equal((await trip.get('')).status, 404);
  });
});

describe('travelers', { skip }, () => {
  it('manages travelers and their non-negotiable item', async () => {
    const user = await api!.newUser();
    const trip = await api!.newTrip(user);

    const created = await trip.post('/travelers', { name: ' Ele ', nonNegotiable: 'nenhum passeio começando às 7h' });
    assert.equal(created.status, 201);
    assert.equal(created.body.traveler.name, 'Ele');

    const id = created.body.traveler.id;
    const updated = await trip.patch(`/travelers/${id}`, { nonNegotiable: 'sem passeio antes das 9h' });
    assert.equal(updated.body.traveler.nonNegotiable, 'sem passeio antes das 9h');

    assert.equal((await trip.post('/travelers', { name: '', nonNegotiable: 'x' })).status, 400);
    assert.equal((await trip.post('/travelers', { name: 'x', nonNegotiable: '' })).status, 400);
    assert.equal((await user.delete(trip.path(`/travelers/${id}`))).status, 204);
    assert.equal((await user.delete(trip.path(`/travelers/${id}`))).status, 404);
  });

  it('limits how many travelers a trip can have', async () => {
    const user = await api!.newUser();
    const trip = await api!.newTrip(user);

    for (let i = 0; i < 20; i++) {
      assert.equal((await trip.post('/travelers', { name: `T${i}`, nonNegotiable: 'x' })).status, 201);
    }
    assert.equal((await trip.post('/travelers', { name: 'one too many', nonNegotiable: 'x' })).status, 409);
  });
});

describe('AI settings', { skip }, () => {
  it('requires the key the first time and never returns it', async () => {
    const user = await api!.newUser({ aiKey: null });

    assert.equal((await user.get('/ai/settings')).body.settings, null);
    assert.equal((await user.put('/ai/settings', {})).status, 400);

    const saved = await user.put('/ai/settings', { apiKey: 'AIza-very-secret-key-1234' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.settings.keyLast4, '1234');
    assert.ok(!JSON.stringify(saved.body).includes('very-secret'));
    assert.ok(!JSON.stringify((await user.get('/ai/settings')).body).includes('very-secret'));

    // Only the public fields come back: no key, and no encrypted copy of it either.
    const publicFields = ['keyLast4', 'model', 'provider', 'updatedAt'];
    assert.deepEqual(Object.keys(saved.body.settings).sort(), publicFields);
    assert.deepEqual(Object.keys((await user.get('/ai/settings')).body.settings).sort(), publicFields);
  });

  it('stores the key encrypted', async () => {
    const user = await api!.newUser({ aiKey: null });
    await user.put('/ai/settings', { apiKey: 'AIza-plaintext-check-9999' });
    const { getPrisma } = await import('../../src/lib/prisma.js');

    const rows = await getPrisma().$queryRawUnsafe<{ encryptedKey: string }[]>(
      `SELECT "encryptedKey" FROM "AiSettings" WHERE "keyLast4" = '9999' ORDER BY "createdAt" DESC LIMIT 1`,
    );
    assert.ok(rows[0]);
    assert.ok(!rows[0].encryptedKey.includes('plaintext-check'));
    assert.equal(rows[0].encryptedKey.split('.').length, 3);
  });

  it('changes only the model or only the key without resetting the other', async () => {
    const user = await api!.newUser({ aiKey: null });
    await user.put('/ai/settings', { apiKey: 'AIza-key-aaaa-1111', model: 'gemini-custom' });

    const newKey = await user.put('/ai/settings', { apiKey: 'AIza-key-bbbb-2222' });
    assert.deepEqual([newKey.body.settings.model, newKey.body.settings.keyLast4], ['gemini-custom', '2222']);

    const newModel = await user.put('/ai/settings', { model: 'gemini-other' });
    assert.deepEqual([newModel.body.settings.model, newModel.body.settings.keyLast4], ['gemini-other', '2222']);
  });

  it('refuses a model name that could alter the request URL', async () => {
    const user = await api!.newUser();

    for (const model of ['../x', 'a/b', 'a?b=1', 'a b', '']) {
      assert.equal((await user.put('/ai/settings', { model })).status, 400, JSON.stringify(model));
    }
  });

  it('tests the connection and reports a rejected key', async () => {
    const good = await api!.newUser({ aiKey: FAKE_GOOD_KEY });
    assert.deepEqual((await good.post('/ai/settings/test')).body, { ok: true });

    const bad = await api!.newUser({ aiKey: FAKE_BAD_KEY });
    const rejected = await bad.post('/ai/settings/test');
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.reason, 'INVALID_KEY');

    assert.equal((await (await api!.newUser({ aiKey: null })).post('/ai/settings/test')).status, 404);
  });

  it('keeps each user’s key separate and can delete it', async () => {
    const a = await api!.newUser({ aiKey: null });
    const b = await api!.newUser({ aiKey: null });
    await a.put('/ai/settings', { apiKey: 'AIza-user-a-1111' });
    await b.put('/ai/settings', { apiKey: 'AIza-user-b-2222' });

    assert.equal((await a.get('/ai/settings')).body.settings.keyLast4, '1111');
    assert.equal((await a.delete('/ai/settings')).status, 204);
    assert.equal((await a.get('/ai/settings')).body.settings, null);
    assert.equal((await b.get('/ai/settings')).body.settings.keyLast4, '2222');
  });
});
