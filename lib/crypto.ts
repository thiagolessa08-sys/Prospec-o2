import { AppError } from './validation';

async function keyFrom(secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(secret))
    throw new AppError(
      'A proteção das conexões ainda não foi configurada no servidor.',
      503,
    );
  const bytes = Uint8Array.from(secret.match(/.{2}/g)!, (h) => parseInt(h, 16));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}
export async function encrypt(value: string, secret: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    await keyFrom(secret),
    new TextEncoder().encode(value),
  );
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(encrypted)));
}
export async function decrypt(value: string, secret: string, context: string) {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const decoded = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: bytes.slice(0, 12),
      additionalData: new TextEncoder().encode(context),
    },
    await keyFrom(secret),
    bytes.slice(12),
  );
  return new TextDecoder().decode(decoded);
}
