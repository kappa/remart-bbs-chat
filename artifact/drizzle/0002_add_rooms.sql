CREATE TABLE rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  max_participants INTEGER DEFAULT 10,
  is_lobby INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  handle TEXT NOT NULL,
  color TEXT NOT NULL,
  line_slot INTEGER NOT NULL,
  joined_at INTEGER NOT NULL
);
