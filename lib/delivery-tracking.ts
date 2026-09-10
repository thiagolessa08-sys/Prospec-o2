import type { DeliveryTracking } from './types';

export const resendEventFields = {
  'email.sent': 'acceptedAt',
  'email.delivered': 'deliveredAt',
  'email.opened': 'openedAt',
  'email.clicked': 'clickedAt',
  'email.bounced': 'bouncedAt',
  'email.failed': 'failedAt',
  'email.delivery_delayed': 'delayedAt',
  'email.complained': 'complainedAt',
  'email.suppressed': 'suppressedAt',
} as const satisfies Record<string, keyof DeliveryTracking>;

export type ResendEventType = keyof typeof resendEventFields;

export function isResendEventType(value: string): value is ResendEventType {
  return value in resendEventFields;
}

export function applyDeliveryEvent(
  current: DeliveryTracking | undefined,
  type: string,
  createdAt: string,
): DeliveryTracking {
  const next = { ...current };
  if (isResendEventType(type)) {
    const field = resendEventFields[type];
    const existing = next[field];
    if (!existing || Date.parse(createdAt) < Date.parse(existing))
      next[field] = createdAt;
  }
  if (
    !next.lastEventAt ||
    Date.parse(createdAt) >= Date.parse(next.lastEventAt)
  ) {
    next.lastEvent = type;
    next.lastEventAt = createdAt;
  }
  return next;
}

export function normalizeResendLastEvent(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^email\./, '');
  const type = `email.${normalized}`;
  return isResendEventType(type) ? type : undefined;
}

export function deliveryFlags(delivery?: DeliveryTracking) {
  const clicked = Boolean(delivery?.clickedAt);
  const opened = Boolean(delivery?.openedAt) || clicked;
  const delivered = Boolean(delivery?.deliveredAt) || opened;
  const bounced = Boolean(
    delivery?.bouncedAt || delivery?.failedAt || delivery?.suppressedAt,
  );
  return { delivered, opened, clicked, bounced };
}
