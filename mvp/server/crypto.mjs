import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export function seal(value, key, context) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
}
export function unseal(value, key, context) {
  const envelope = Buffer.from(value);
  if (envelope[0] !== 1 || envelope.length < 30) throw new Error('Invalid encrypted record');
  const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(1, 13));
  decipher.setAuthTag(envelope.subarray(13, 29));
  decipher.setAAD(Buffer.from(context));
  return JSON.parse(Buffer.concat([decipher.update(envelope.subarray(29)), decipher.final()]).toString('utf8'));
}
