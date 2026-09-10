import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDeliveryEvent,
  deliveryFlags,
  normalizeResendLastEvent,
} from '../lib/delivery-tracking.ts';
import { textEmailHtml } from '../lib/pipeline.ts';

test('delivery events preserve the latest state even when Resend delivers them out of order', () => {
  let tracking = applyDeliveryEvent(
    undefined,
    'email.opened',
    '2026-09-09T12:05:00.000Z',
  );
  tracking = applyDeliveryEvent(
    tracking,
    'email.delivered',
    '2026-09-09T12:02:00.000Z',
  );
  assert.equal(tracking.deliveredAt, '2026-09-09T12:02:00.000Z');
  assert.equal(tracking.lastEvent, 'email.opened');
  assert.deepEqual(deliveryFlags(tracking), {
    delivered: true,
    opened: true,
    clicked: false,
    bounced: false,
  });
  assert.equal(normalizeResendLastEvent('clicked'), 'email.clicked');
});

test('the HTML alternative enables tracking without trusting generated markup', () => {
  const html = textEmailHtml(
    'Olá <script>alert(1)</script>\nhttps://example.com/conversa',
  );
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<a href="https:\/\/example.com\/conversa">/);
  assert.match(html, /<br>/);
});
