ALTER TABLE participants ADD COLUMN active_content TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE lines (
  id TEXT PRIMARY KEY NOT NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  handle TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  committed INTEGER NOT NULL DEFAULT 1,
  line_idx INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX lines_room_created_at_idx ON lines(room_id, created_at);
--> statement-breakpoint
CREATE TABLE char_events (
  id TEXT PRIMARY KEY NOT NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  handle TEXT NOT NULL,
  char TEXT NOT NULL,
  line_idx INTEGER NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX char_events_room_created_at_idx ON char_events(room_id, created_at);
