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
- [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — current HTTP and WebSocket messages,
  payloads, ordering, session lifecycle, and client behavior.
- [`docs/SPECS_STATUS.md`](docs/SPECS_STATUS.md) — which docs are
  authoritative; `docs/archive/` holds the superseded original specs.

## Structure

- `client/src/App.tsx` — UI: rooms, typing, live updates, scrollback
- `client/src/connection.ts` — socket lifecycle and keystroke replay
- `client/src/roomState.ts` — server messages to room state
- `client/src/api.ts` — REST client for rooms, join, leave, roster
- `client/src/theme.css` — monospace terminal theme
- `server/index.js` — Express + WebSocket server, in-memory rooms

## Run standalone

```bash
npm install
npm --prefix client install
npm --prefix client run build  # builds client/dist
npm start  # PORT env, default 3000
```

## Repo

https://github.com/kappa/remart-bbs-chat
