DELETE FROM participants
WHERE id NOT IN (
  SELECT MIN(id) FROM participants GROUP BY handle COLLATE NOCASE
);
--> statement-breakpoint
DELETE FROM participants
WHERE id NOT IN (
  SELECT MIN(id) FROM participants GROUP BY room_id, line_slot
);
--> statement-breakpoint
DELETE FROM participants
WHERE id NOT IN (
  SELECT MIN(id) FROM participants GROUP BY room_id, color
);
--> statement-breakpoint
CREATE UNIQUE INDEX participants_handle_nocase_unique
ON participants(handle COLLATE NOCASE);
--> statement-breakpoint
CREATE UNIQUE INDEX participants_room_line_slot_unique
ON participants(room_id, line_slot);
--> statement-breakpoint
CREATE UNIQUE INDEX participants_room_color_unique
ON participants(room_id, color);
