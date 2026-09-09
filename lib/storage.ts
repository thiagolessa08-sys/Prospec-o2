import { env } from 'cloudflare:workers';
import { encrypt, decrypt } from './crypto';
import { AppError } from './validation';
import type { Campaign, SettingsView } from './types';
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
  const rows = await database()
    .prepare('SELECT payload FROM campaigns ORDER BY created_at DESC LIMIT 100')
    .all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload) as Campaign);
}
export async function createCampaign(c: Campaign) {
  await database()
    .prepare('INSERT INTO campaigns (id, created_at, payload) VALUES (?, ?, ?)')
    .bind(c.id, c.createdAt, JSON.stringify(c))
    .run();
  return c;
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
