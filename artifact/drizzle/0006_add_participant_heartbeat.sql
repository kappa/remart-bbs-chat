ALTER TABLE participants ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE participants SET last_seen = joined_at WHERE last_seen = 0;
--> statement-breakpoint
DROP INDEX participants_handle_nocase_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX participants_room_handle_nocase_unique
ON participants(room_id, handle COLLATE NOCASE);
