import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  encrypted: text('encrypted').notNull(),
});
export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
  payload: text('payload').notNull(),
  lease: text('lease'),
  leaseUntil: integer('lease_until').notNull().default(0),
});
export const deliveries = sqliteTable('deliveries', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull(),
  email: text('email').notNull(),
  status: text('status').notNull(),
  providerId: text('provider_id'),
  createdAt: text('created_at').notNull(),
});
