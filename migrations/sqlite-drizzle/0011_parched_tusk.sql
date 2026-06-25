PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_message` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`topic_id` text NOT NULL,
	`role` text NOT NULL,
	`data` text NOT NULL,
	`searchable_text` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`siblings_group_id` integer DEFAULT 0 NOT NULL,
	`model_id` text,
	`model_snapshot` text,
	`stats` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_role_check" CHECK("__new_message"."role" IN ('user', 'assistant', 'system', 'root')),
	CONSTRAINT "message_status_check" CHECK("__new_message"."status" IN ('pending', 'success', 'error', 'paused')),
	CONSTRAINT "message_root_parent_check" CHECK(("__new_message"."role" = 'root') = ("__new_message"."parent_id" is null))
);
--> statement-breakpoint
CREATE TEMP TABLE `__message_root_map` (
	`topic_id` text PRIMARY KEY NOT NULL,
	`root_id` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__message_root_map`("topic_id", "root_id")
SELECT "topic_id", lower(hex(randomblob(16)))
FROM (SELECT DISTINCT "topic_id" FROM `message`);
--> statement-breakpoint
INSERT INTO `__new_message`("id", "parent_id", "topic_id", "role", "data", "searchable_text", "status", "siblings_group_id", "model_id", "model_snapshot", "stats", "created_at", "updated_at", "deleted_at")
SELECT
	"root_id",
	NULL,
	"topic_id",
	'root',
	'{"parts":[]}',
	'',
	'success',
	0,
	NULL,
	NULL,
	NULL,
	(SELECT COALESCE(MIN("created_at"), 0) FROM `message` WHERE `message`.`topic_id` = `__message_root_map`.`topic_id`),
	(SELECT COALESCE(MIN("updated_at"), 0) FROM `message` WHERE `message`.`topic_id` = `__message_root_map`.`topic_id`),
	NULL
FROM `__message_root_map`;
--> statement-breakpoint
INSERT INTO `__new_message`("id", "parent_id", "topic_id", "role", "data", "searchable_text", "status", "siblings_group_id", "model_id", "model_snapshot", "stats", "created_at", "updated_at", "deleted_at")
SELECT
	`message`.`id`,
	CASE
		WHEN `message`.`parent_id` IS NULL THEN `__message_root_map`.`root_id`
		ELSE `message`.`parent_id`
	END,
	`message`.`topic_id`,
	CASE
		WHEN `message`.`role` IN ('user', 'assistant', 'system') THEN `message`.`role`
		ELSE 'system'
	END,
	`message`.`data`,
	`message`.`searchable_text`,
	`message`.`status`,
	`message`.`siblings_group_id`,
	`message`.`model_id`,
	`message`.`model_snapshot`,
	`message`.`stats`,
	`message`.`created_at`,
	`message`.`updated_at`,
	`message`.`deleted_at`
FROM `message`
INNER JOIN `__message_root_map` ON `__message_root_map`.`topic_id` = `message`.`topic_id`;
--> statement-breakpoint
DROP TABLE `__message_root_map`;--> statement-breakpoint
DROP TABLE `message`;--> statement-breakpoint
ALTER TABLE `__new_message` RENAME TO `message`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `message_parent_id_idx` ON `message` (`parent_id`);--> statement-breakpoint
CREATE INDEX `message_topic_created_idx` ON `message` (`topic_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `message_status_idx` ON `message` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_topic_root_uniq` ON `message` (`topic_id`) WHERE "message"."parent_id" is null and "message"."deleted_at" is null;
