import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// Server-only credential encryption for cloud-provider secrets.
// The 32-byte key is derived from APP_ENCRYPTION_KEY (any long random string).
// Ciphertext format (base64): iv(12) | authTag(16) | ciphertext.

function getKey(): Buffer {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret || secret === 'change-me-to-a-long-random-string') {
    throw new Error(
      'APP_ENCRYPTION_KEY is not set. Add a long random string to .env.local (e.g. `openssl rand -base64 48`).'
    );
  }
  return createHash('sha256').update(secret).digest(); // always 32 bytes
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
