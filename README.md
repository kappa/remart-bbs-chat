# Remart BBS Chat — Full Stack Export

> Modern web prototype of Remart BBS chat — char-by-char typing, visible Backspace, concurrent lines, color-coded roster. This repo contains **both client and server** for external hosting.

This is part of Remart BBS — not just chat, but chat is the first prototype module.

## Structure

- `client/src/App.tsx` (936 lines) — main UI, rooms, typing, heartbeat 12s, Enter semantics
- `client/src/api.ts` — typed RPC client
- `client/src/theme.css` — monospace theme
- `server/src/actions.ts` (891 lines) — authoritative actions
- `server/src/schema.ts` — Drizzle: rooms, participants, lines, charEvents
- `server/index.js` — standalone Express+WS for Render/Fly.io
- `artifact/` — original Hatch TS-space with drizzle migrations 0001..0006
- `rooms.js`, `char-broadcast.js` — legacy prototype logic
- `test-*.js` — tests

## Behavior (from final spec)

- Monospace mandatory, one shared scrolling area, color identifies author
- Each participant owns active line, 80-cell limit, ASCII only, paste capped 20, 10 cps throttling
- Enter commits in place, new empty line appears below all lines (per 2026-09-02 clarification)
- Backspace col0 ignored, no whole-line delete
- Commands l/?/q only when trimmed line == single char + Enter
- Heartbeat 12s client, 40s server timeout, stale cleanup with leave line
- `?name=Alice&room=1` per-tab override, doesn't overwrite localStorage

## Run standalone

```bash
npm install
npm start   # PORT env, default 3000
```

Render: Web Service, build `npm install`, start `node server/index.js`, single instance (in-memory rooms).
Fly.io: `fly launch && fly deploy`

## GitHub

https://github.com/kappa/remart-bbs-chat
# trigger deploy 2026-09-03T03:05:21Z
