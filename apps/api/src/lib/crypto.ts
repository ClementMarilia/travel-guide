import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

// ENCRYPTION_KEY: 32 random bytes, base64-encoded (e.g. `openssl rand -base64 32`).
function getKey(): Buffer {
  const encoded = process.env.ENCRYPTION_KEY;

  if (!encoded) {
    throw new Error('ENCRYPTION_KEY is not configured');
  }

  const key = Buffer.from(encoded, 'base64');

  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  }

  return key;
}

// Output format: base64(iv).base64(authTag).base64(ciphertext)
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
}

export function decryptSecret(payload: string): string {
  const [iv, authTag, ciphertext] = payload.split('.').map((part) => Buffer.from(part, 'base64'));

  if (!iv || !authTag || !ciphertext) {
    throw new Error('Malformed encrypted payload');
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
