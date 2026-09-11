import { env } from 'cloudflare:workers';
import { encrypt, decrypt } from './crypto';
import { AppError } from './validation';
import type { Campaign, SettingsView } from './types';
import { applyDeliveryEvent } from './delivery-tracking';
import type { Credentials } from './providers';
import type { DeliveryStore, Receipt } from './pipeline';

function database(): D1Database {
  return (env as unknown as { DB: D1Database }).DB;
}
let startupLeaseReset: Promise<void> | undefined;
function resetOrphanedLeases() {
  startupLeaseReset ??= database()
    .prepare('UPDATE campaigns SET lease=NULL, lease_until=0')
    .run()
    .then(() => undefined);
  return startupLeaseReset;
}
function secret() {
  return (
    (env as unknown as { APP_ENCRYPTION_KEY?: string }).APP_ENCRYPTION_KEY || ''
  );
}
const keys = ['lushaKey', 'anthropicKey', 'resendKey'] as const;
const environmentNames = {
  lushaKey: 'LUSHA_API_KEY',
  anthropicKey: 'ANTHROPIC_API_KEY',
  resendKey: 'RESEND_API_KEY',
} as const;

function environmentCredentials(): Credentials {
  const runtime = env as unknown as Record<string, unknown>;
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = runtime[environmentNames[key]];
      return typeof value === 'string' && value.trim()
        ? [[key, value.trim()]]
        : [];
    }),
  );
}

export async function settingsView(): Promise<SettingsView> {
  const rows = await database()
    .prepare('SELECT key FROM settings')
    .all<{ key: string }>();
  const managed = environmentCredentials();
  return {
    connected: Object.fromEntries(
      keys.map((k) => [
        k,
        Boolean(managed[k]) || rows.results.some((r) => r.key === k),
      ]),
    ),
    managed: Object.fromEntries(keys.map((k) => [k, Boolean(managed[k])])),
  };
}
export async function getCredentials(): Promise<Credentials> {
  const rows = await database()
    .prepare('SELECT key, encrypted FROM settings')
    .all<{ key: string; encrypted: string }>();
  const result: Credentials = {};
  for (const row of rows.results)
    if (keys.includes(row.key as (typeof keys)[number]))
      result[row.key as (typeof keys)[number]] = await decrypt(
        row.encrypted,
        secret(),
        row.key,
      );
  return { ...result, ...environmentCredentials() };
}
export async function saveCredentials(raw: Record<string, unknown>) {
  const statements: D1PreparedStatement[] = [];
  for (const key of keys) {
    if (raw[key] === undefined || raw[key] === '') continue;
    const value = raw[key];
    if (
      typeof value !== 'string' ||
      value.trim().length < 10 ||
      value.length > 2048 ||
      /\s/.test(value.trim())
    )
      throw new AppError(`Chave inválida para ${key.replace('Key', '')}.`);
    statements.push(
      database()
        .prepare(
          'INSERT INTO settings (key, encrypted) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET encrypted=excluded.encrypted',
        )
        .bind(key, await encrypt(value.trim(), secret(), key)),
    );
  }
  if (statements.length) await database().batch(statements);
  return settingsView();
}
export async function listCampaigns() {
  const [rows, events] = await Promise.all([
    database()
      .prepare(
        'SELECT payload FROM campaigns ORDER BY created_at DESC LIMIT 100',
      )
      .all<{ payload: string }>(),
    database()
      .prepare(
        'SELECT campaign_id AS campaignId, provider_id AS providerId, type, created_at AS createdAt FROM delivery_events ORDER BY created_at ASC',
      )
      .all<{
        campaignId: string;
        providerId: string;
        type: string;
        createdAt: string;
      }>(),
  ]);
  const campaigns = rows.results.map(
    (row) => JSON.parse(row.payload) as Campaign,
  );
  const byCampaign = new Map(
    campaigns.map((campaign) => [campaign.id, campaign]),
  );
  for (const event of events.results) {
    const campaign = byCampaign.get(event.campaignId);
    const lead = campaign?.leads.find(
      (candidate) => candidate.providerId === event.providerId,
    );
    if (lead)
      lead.delivery = applyDeliveryEvent(
        lead.delivery,
        event.type,
        event.createdAt,
      );
  }
  return campaigns;
}

export async function recordResendEvent(input: {
  id: string;
  campaignId?: string;
  providerId: string;
  type: string;
  createdAt: string;
}) {
  const receipt = await database()
    .prepare(
      'SELECT campaign_id AS campaignId FROM deliveries WHERE provider_id=? LIMIT 1',
    )
    .bind(input.providerId)
    .first<{ campaignId: string }>();
  const campaignId = input.campaignId || receipt?.campaignId;
  if (!campaignId) return { matched: false, stored: false };
  const campaign = await database()
    .prepare('SELECT id FROM campaigns WHERE id=? LIMIT 1')
    .bind(campaignId)
    .first<{ id: string }>();
  if (!campaign) return { matched: false, stored: false };
  const result = await database()
    .prepare(
      'INSERT OR IGNORE INTO delivery_events (id, campaign_id, provider_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(input.id, campaignId, input.providerId, input.type, input.createdAt)
    .run();
  return { matched: true, stored: result.meta.changes === 1 };
}
export async function createCampaign(c: Campaign) {
  await database()
    .prepare('INSERT INTO campaigns (id, created_at, payload) VALUES (?, ?, ?)')
    .bind(c.id, c.createdAt, JSON.stringify(c))
    .run();
  return c;
}

export async function updateCampaign(
  id: string,
  input: Campaign['input'],
) {
  return withCampaign(id, async (campaign) => {
    if (campaign.stage === 'send')
      throw new AppError(
        'A campanha está enviando e-mails. Aguarde o fim do envio para editá-la.',
        409,
      );
    campaign.input = input;
    return campaign;
  });
}

export async function deleteCampaign(id: string) {
  await resetOrphanedLeases();
  const row = await database()
    .prepare('SELECT lease_until AS leaseUntil FROM campaigns WHERE id=?')
    .bind(id)
    .first<{ leaseUntil: number }>();
  if (!row) throw new AppError('Campanha não encontrada.', 404);
  if (row.leaseUntil >= Date.now())
    throw new AppError(
      'Esta campanha está sendo processada. Aguarde antes de excluí-la.',
      409,
    );
  await database().batch([
    database()
      .prepare('DELETE FROM delivery_events WHERE campaign_id=?')
      .bind(id),
    database().prepare('DELETE FROM deliveries WHERE campaign_id=?').bind(id),
    database().prepare('DELETE FROM campaigns WHERE id=?').bind(id),
  ]);
}

export async function withCampaign(
  id: string,
  fn: (c: Campaign) => Promise<Campaign>,
) {
  // A worker restart terminates in-flight requests. Clear those leases once
  // before the first resumed campaign in this process.
  await resetOrphanedLeases();
  const lease = crypto.randomUUID();
  const claimed = await database()
    .prepare(
      'UPDATE campaigns SET lease=?, lease_until=? WHERE id=? AND lease_until < ?',
    )
    .bind(lease, Date.now() + 600000, id, Date.now())
    .run();
  if (claimed.meta.changes !== 1)
    throw new AppError(
      'Esta campanha está sendo processada em outra solicitação, ou não existe. Aguarde antes de retomar.',
      409,
    );
  try {
    const row = await database()
      .prepare('SELECT payload FROM campaigns WHERE id=? AND lease=?')
      .bind(id, lease)
      .first<{ payload: string }>();
    if (!row) throw new AppError('Campanha não encontrada.', 404);
    const c = await fn(JSON.parse(row.payload) as Campaign);
    const saved = await database()
      .prepare('UPDATE campaigns SET payload=? WHERE id=? AND lease=?')
      .bind(JSON.stringify(c), id, lease)
      .run();
    if (saved.meta.changes !== 1)
      throw new AppError(
        'Não foi possível salvar o progresso. Reabra a campanha.',
        409,
      );
    return c;
  } finally {
    await database()
      .prepare(
        'UPDATE campaigns SET lease=NULL, lease_until=0 WHERE id=? AND lease=?',
      )
      .bind(id, lease)
      .run();
  }
}
export const deliveryStore: DeliveryStore = {
  async claim(id, campaignId, email) {
    const result = await database()
      .prepare(
        'INSERT OR IGNORE INTO deliveries (id, campaign_id, email, status, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(id, campaignId, email, 'sending', new Date().toISOString())
      .run();
    return result.meta.changes === 1;
  },
  async get(id) {
    return database()
      .prepare(
        'SELECT status, provider_id AS providerId FROM deliveries WHERE id=?',
      )
      .bind(id)
      .first<Receipt>();
  },
  async finish(id, status, providerId) {
    await database()
      .prepare('UPDATE deliveries SET status=?, provider_id=? WHERE id=?')
      .bind(status, providerId || null, id)
      .run();
  },
};
