# Remart BBS Chat

Modern web prototype of Remart BBS chat — char-by-char typing, visible Backspace, concurrent lines, color-coded roster, DOS-authentic feel.

Live: `https://remart-bbs-chat.fly.dev/`

## Structure

- `client/src/App.tsx` — main UI, rooms, typing, WebSocket live updates, heartbeat 12s, Enter semantics
- `client/src/api.ts` — typed REST client for `/api/*`
- `client/src/theme.css` — monospace theme, 1.55em line height
- `server/index.js` — standalone Express + WS server, in-memory rooms, authoritative char order

## Behavior

- Monospace mandatory, one shared scrolling document, color identifies author
- One active line per participant, characters and Backspace appear immediately (optimistic + WS broadcast)
- WebSocket push for remote updates, 2s polling fallback
- Unicode (including Cyrillic) allowed, no 80-char limit
- Enter commits in place without redrawing line, allows empty lines, ownership deferred to first typed char
- Join/leave lines use author's assigned color, history preserves color after leave
- Join chirp via Web Audio when new participant appears
- Commands `l` / `?` / `q` only when trimmed line is exactly that single char + Enter
- Heartbeat 12s client, 40s server timeout, stale cleanup preserves nonempty active text
- `?name=Alice` per-tab override, doesn't overwrite remembered default
- Pinned roster, ~10 participants per room, ephemeral rooms

## Run standalone

```bash
npm install
npm run build --workspace=client  # builds client/dist
npm start  # PORT env, default 3000
```

Fly.io: `fly deploy` using included `Dockerfile` and `fly.toml` — single cheapest Machine, shared IPv4.

## Repo

https://github.com/kappa/remart-bbs-chat
