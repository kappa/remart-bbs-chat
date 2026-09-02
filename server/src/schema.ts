import {
integer,
sqliteTable,
text,
uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Preserve the scaffold table: it is part of the existing database contract.
export const entries = sqliteTable("entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  maxParticipants: integer("max_participants").default(10),
  isLobby: integer("is_lobby", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const participants = sqliteTable(
  "participants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id),
    handle: text("handle").notNull(),
    color: text("color").notNull(),
    lineSlot: integer("line_slot").notNull(),
    // Stable participant/color slot is separate from the active line's place
    // in the shared vertical stream. Enter advances only activeLineIdx.
    activeLineIdx: integer("active_line_idx").notNull().default(0),
    activeContent: text("active_content").notNull().default(""),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeen: integer("last_seen", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // Migration 0006 creates the matching room-scoped index with COLLATE
    // NOCASE, so a display name can exist once in each independent room.
    uniqueIndex("participants_room_handle_nocase_unique").on(
      table.roomId,
      table.handle,
    ),
    uniqueIndex("participants_room_line_slot_unique").on(
      table.roomId,
      table.lineSlot,
    ),
    uniqueIndex("participants_room_color_unique").on(
      table.roomId,
      table.color,
    ),
  ],
);

// A row is appended whenever Enter commits the participant's current line.
// Join and leave notices use the same stream with `* handle joined/left` text.
// The participant's live, legitimate chat text remains on participants while
// it is being typed so there is exactly one server-authoritative active line.
export const lines = sqliteTable("lines", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id),
  handle: text("handle").notNull(),
  content: text("content").notNull().default(""),
  committed: integer("committed", { mode: "boolean" })
    .notNull()
    .default(true),
  lineIdx: integer("line_idx").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Keystroke audit rows make the authoritative server order observable without
// asking clients to reconstruct it from timing.
export const charEvents = sqliteTable("char_events", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id),
  handle: text("handle").notNull(),
  char: text("char").notNull(),
  lineIdx: integer("line_idx").notNull(),
  position: integer("position").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
