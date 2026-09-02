# Task 2 Implementation Notes - Corrected for TypeScript Space

## Issue Found
Initial edit used generic Node.js ws description, but artifact is TypeScript space (platform 20) with:
- Drizzle ORM (server/src/schema.ts, drizzle/*.sql)
- @hatch/space-sdk actions (server/src/actions.ts)
- React client (client/src/App.tsx)

## Corrected Approach (per AGENTS.md and inspection)
Preserve entries table and 0001_initial.sql.

Add via migration 0002_add_rooms.sql:
- rooms table
- participants table

Add actions:
- listRooms
- getOrCreateRoom (infinite auto-create when full)
- joinRoom (10 max, color pool, system-wide handle uniqueness, one room per user)
- leaveRoom (empty slot freed)
- getRoster (for l command)

## Local Tests (passing)
- ~/workspace/remart-chat/rooms.js - Rooms class with same logic for reference
- ~/workspace/remart-chat/test-rooms.js - PASS all:
  - room max 10 throws "room full"
  - 10 users => 10 lines
  - empty disconnect frees slot
  - typed line stays as history

## Builder Steering
Sent corrected instructions to builder agent 9463e670-8660-4828-ab8a-6cf8df320e8f via artifact.send_input.

Awaiting build completion.
