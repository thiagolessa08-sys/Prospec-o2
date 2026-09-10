import { env } from 'cloudflare:workers';
import { Webhook } from 'svix';
import { isResendEventType } from '@/lib/delivery-tracking';
import { recordResendEvent } from '@/lib/storage';

const responseHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: responseHeaders });
}

type ResendWebhook = {
  type?: unknown;
  created_at?: unknown;
  data?: {
    email_id?: unknown;
    tags?: unknown;
  };
};

export async function POST(request: Request) {
  const secret = (env as unknown as { RESEND_WEBHOOK_SECRET?: string })
    .RESEND_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'Webhook não configurado.' }, 503);
  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signature = request.headers.get('svix-signature');
  if (!id || !timestamp || !signature)
    return json({ error: 'Assinatura ausente.' }, 400);
  const body = await request.text();
  let event: ResendWebhook;
  try {
    new Webhook(secret).verify(body, {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    });
    event = JSON.parse(body) as ResendWebhook;
  } catch {
    return json({ error: 'Assinatura inválida.' }, 400);
  }
  if (
    typeof event.type !== 'string' ||
    !isResendEventType(event.type) ||
    typeof event.data?.email_id !== 'string'
  )
    return json({ received: true, stored: false });
  const tags = event.data.tags;
  const campaignId =
    tags && typeof tags === 'object' && !Array.isArray(tags)
      ? (tags as Record<string, unknown>).campaign
      : undefined;
  const result = await recordResendEvent({
    id,
    campaignId: typeof campaignId === 'string' ? campaignId : undefined,
    providerId: event.data.email_id,
    type: event.type,
    createdAt:
      typeof event.created_at === 'string'
        ? event.created_at
        : new Date().toISOString(),
  });
  return json({ received: true, stored: result.stored });
}
