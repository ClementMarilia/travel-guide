import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { decryptSecret, encryptSecret } from '../../src/lib/crypto.js';

describe('secret encryption', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  afterEach(() => {
    if (original === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = original;
  });

  it('round-trips a secret', () => {
    assert.equal(decryptSecret(encryptSecret('AIza-my-key')), 'AIza-my-key');
  });

  it('does not contain the plaintext and differs on every call', () => {
    const a = encryptSecret('AIza-my-key');
    const b = encryptSecret('AIza-my-key');

    assert.ok(!a.includes('AIza-my-key'));
    assert.notEqual(a, b);
  });

  it('rejects a tampered ciphertext, auth tag or iv', () => {
    const [iv, tag, ciphertext] = encryptSecret('a long enough secret value').split('.') as [string, string, string];
    const flip = (value: string) => {
      const bytes = Buffer.from(value, 'base64');
      bytes[0] = bytes[0]! ^ 1;
      return bytes.toString('base64');
    };

    assert.throws(() => decryptSecret([iv, tag, flip(ciphertext)].join('.')));
    assert.throws(() => decryptSecret([iv, flip(tag), ciphertext].join('.')));
    assert.throws(() => decryptSecret([flip(iv), tag, ciphertext].join('.')));
  });

  it('rejects a malformed payload', () => {
    assert.throws(() => decryptSecret('not-a-payload'));
  });

  it('cannot decrypt with a different key', () => {
    const encrypted = encryptSecret('secret');
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');

    assert.throws(() => decryptSecret(encrypted));
  });

  it('refuses to work without a valid key', () => {
    delete process.env.ENCRYPTION_KEY;
    assert.throws(() => encryptSecret('x'), /ENCRYPTION_KEY is not configured/);

    process.env.ENCRYPTION_KEY = Buffer.from('too short').toString('base64');
    assert.throws(() => encryptSecret('x'), /32 bytes/);
  });
});
