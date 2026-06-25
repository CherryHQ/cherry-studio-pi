ALTER TABLE `knowledge_base` ADD `chunk_strategy` text DEFAULT 'structured' NOT NULL;
--> statement-breakpoint
ALTER TABLE `knowledge_base` ADD `chunk_separator` text DEFAULT '\n\n' NOT NULL;
