CREATE TABLE `delivery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`type` text NOT NULL,
	`created_at` text NOT NULL
);
