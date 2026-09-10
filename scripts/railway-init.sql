CREATE TABLE IF NOT EXISTS `campaigns` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` text NOT NULL,
  `payload` text NOT NULL,
  `lease` text,
  `lease_until` integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS `deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `campaign_id` text NOT NULL,
  `email` text NOT NULL,
  `status` text NOT NULL,
  `provider_id` text,
  `created_at` text NOT NULL
);

CREATE TABLE IF NOT EXISTS `settings` (
  `key` text PRIMARY KEY NOT NULL,
  `encrypted` text NOT NULL
);

CREATE TABLE IF NOT EXISTS `delivery_events` (
  `id` text PRIMARY KEY NOT NULL,
  `campaign_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `type` text NOT NULL,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_delivery_events_campaign_provider`
ON `delivery_events` (`campaign_id`, `provider_id`);

-- A process restart ends any in-flight request, so its lease cannot remain active.
UPDATE `campaigns` SET `lease` = NULL, `lease_until` = 0;
