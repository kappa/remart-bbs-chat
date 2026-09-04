# Remart BBS Chat

Char-by-char shared chat with a DOS-terminal feel: everyone's typing appears
live, including the backspaces. One shared transcript, color-coded authors,
ephemeral rooms.

## Testing deployment

Live for testing: **https://remart-bbs-chat.fly.dev/**

Deployed via the Fly.io dashboard (no image builds involved) — one Machine,
shared IPv4.

## Docs

- [`docs/USER_EXPERIENCE.md`](docs/USER_EXPERIENCE.md) — what using it is
  like, treating the system as a black box.
- [`docs/DESIGN.md`](docs/DESIGN.md) — design decisions: why it behaves that
  way.
- [`docs/SPECS_STATUS.md`](docs/SPECS_STATUS.md) — which older specs are
  historical and which docs are authoritative.

## Structure

- `client/src/App.tsx` — UI: rooms, typing, live updates, scrollback
- `client/src/api.ts` — typed REST client for `/api/*`
- `client/src/theme.css` — monospace terminal theme
- `server/index.js` — Express + WebSocket server, in-memory rooms

## Run standalone

```bash
npm install
npm run build --workspace=client  # builds client/dist
npm start  # PORT env, default 3000
```

## Repo

https://github.com/kappa/remart-bbs-chat
