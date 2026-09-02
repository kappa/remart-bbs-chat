ALTER TABLE participants ADD COLUMN active_line_idx INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
WITH ranked_lines AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY room_id
      ORDER BY created_at ASC, id ASC
    ) - 1 AS document_idx
  FROM lines
)
UPDATE lines
SET line_idx = (
  SELECT document_idx
  FROM ranked_lines
  WHERE ranked_lines.id = lines.id
);
--> statement-breakpoint
UPDATE participants
SET active_line_idx = COALESCE(
  (SELECT MAX(lines.line_idx) FROM lines WHERE lines.room_id = participants.room_id),
  -1
) + 1 + line_slot;
