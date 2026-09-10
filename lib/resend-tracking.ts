import { normalizeResendLastEvent } from './delivery-tracking';
import { recordResendEvent } from './storage';
import { ProviderError, type Json } from './providers';

type ResendEmail = {
  id?: unknown;
  last_event?: unknown;
  created_at?: unknown;
};

export async function syncResendDeliveryEvents(key: string) {
  const response = await fetch('https://api.resend.com/emails?limit=100', {
    signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new ProviderError('Resend', response.status);
  const payload = (await response.json()) as Json;
  const emails = Array.isArray(payload.data)
    ? (payload.data as ResendEmail[])
    : [];
  let matched = 0;
  let stored = 0;
  for (const email of emails) {
    if (typeof email.id !== 'string' || typeof email.last_event !== 'string')
      continue;
    const type = normalizeResendLastEvent(email.last_event);
    if (!type) continue;
    const event = await recordResendEvent({
      id: `sync:${email.id}:${type}`,
      providerId: email.id,
      type,
      createdAt:
        typeof email.created_at === 'string'
          ? email.created_at
          : new Date().toISOString(),
    });
    if (event.matched) matched++;
    if (event.stored) stored++;
  }
  return { matched, stored };
}
