# Remart BBS Chat

Modern web prototype of Remart BBS chat — char-by-char typing, visible Backspace, concurrent lines, color-coded roster, DOS-authentic feel.

Live: `https://remart-bbs-chat.fly.dev/`

## Structure

- `client/src/App.tsx` — main UI, rooms, typing, WebSocket live updates, viewer-accumulated scrollback, heartbeat 12s, Enter semantics
- `client/src/api.ts` — typed REST client for `/api/*`
- `client/src/theme.css` — monospace theme, 1.55em line height
- `server/index.js` — standalone Express + WS server, in-memory rooms, seq-ordered ops with buffering, authoritative char order, bounded recovery snapshot (last 100)

## Behavior

- Monospace mandatory, one shared scrolling document, color identifies author
- One active line per participant, characters and Backspace appear immediately (optimistic + WS broadcast)
- WebSocket push for remote updates, 2s polling fallback, direct cache apply (no missed transient char-then-backspace)
- Viewer-accumulated scrollback: server returns bounded last-100 snapshot for recovery, client keeps everything seen since join so upward reading never loses text
- Unicode (including Cyrillic) allowed, no 80-char limit
- Seq-ordered ops: per-participant seq, duplicate detection, out-of-order buffering preserves order (x then Backspace ends empty; A Enter B commits only A)
- Enter commits in place without redrawing line, immediately creates fresh local buffer (typing B after Enter shows B not HiB), allows empty lines, ownership deferred to first typed char
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
