# Remart BBS Chat

Char-by-char shared chat with a DOS-terminal feel: everyone's typing appears
live, including the backspaces. One shared transcript, color-coded authors,
ephemeral rooms.

## Testing deployment

Live for testing: **https://remart-bbs-chat.fly.dev/**

Deployed to Fly.io from `fly.toml` and the `Dockerfile` as one Machine with a
shared IPv4. Alex deploys by hand; nothing deploys from CI.

## Docs

- [`docs/USER_EXPERIENCE.md`](docs/USER_EXPERIENCE.md) — what using it is
  like, treating the system as a black box.
- [`docs/DESIGN.md`](docs/DESIGN.md) — design decisions: why it behaves that
  way.
- [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — current HTTP and WebSocket messages,
  payloads, ordering, session lifecycle, and client behavior.
- [`docs/SPECS_STATUS.md`](docs/SPECS_STATUS.md) — which docs are
  authoritative; `docs/archive/` holds the superseded original specs and the
  executed superpowers specs and plans.
- [`TODO.md`](TODO.md) — the open tasks in the order to do them;
  [`docs/TODO_ARCHIVE.md`](docs/TODO_ARCHIVE.md) keeps the finished ones.
- [`AGENTS.md`](AGENTS.md) — the rules for working here, with the full code
  map, the validation list, and the branch and landing conventions.

## Structure

- `client/` — React 19/TypeScript app built with Vite; `client/src/App.tsx`
  is the UI, `connection.ts` the socket, `roomState.ts` the reducer. The
  code map in `AGENTS.md` names every module.
- `server/index.js` — Express + WebSocket server with in-memory rooms;
  restarting it loses all state.
- `test-server-*.js` — Node test-runner suites for the server;
  `client/src/*.test.{ts,tsx}` — Vitest suites for the client;
  `check-browser.mjs` — a headless-Chrome end-to-end check.

## Run standalone

```bash
npm install
npm --prefix client install
npm --prefix client run build  # builds client/dist
npm start  # PORT env, default 3000
```

There is no dev server: rebuild the client and reload after client changes,
restart `npm start` after server changes.

## Validate

```bash
npm test
npm --prefix client test
npm --prefix client run typecheck
npm --prefix client run build
npm run check:browser   # needs a built client and google-chrome
```

## Repo

https://github.com/kappa/remart-bbs-chat
