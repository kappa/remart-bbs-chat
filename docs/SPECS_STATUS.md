# Specs Status — 2026-09-04 (updated Sep 4)

The superpowers-generated specs in this repo are historical intent, not current truth.

## Current authoritative implementation (as of 2026-09-04)

- `server/index.js` — standalone Express + WS, in-memory rooms, seq-ordered ops with buffering (per-participant seq, duplicate detection, out-of-order buffering + drain), authoritative char order, heartbeat 12s / timeout 40s, color snapshot persistence, bounded recovery snapshot (last 100 committed lines)
- `client/src/App.tsx` — React, optimistic typing with seq, Enter buffer separation (fresh active line immediately, pending committed line visible), WebSocket direct char/backspace apply, viewer-accumulated scrollback (snapshot cutoff does not delete already-seen text), typing-hint hidden on desktop / visible mobile, Unicode (including Cyrillic) allowed, no 80-char limit
- `client/src/theme.css` — 1.55em line-height, DOS-authentic
- `README.md` — current behavior summary

## Historical specs (out of date)

- `docs/superpowers/specs/2026-09-01-remart-bbs-chat-design.md` — Draft from Sep 1, describes 80-cell, ASCII-only, vanilla JS scaffold. Out of date as of Sep 3-4 fixes (Unicode, no limit, deferred ownership, WS live updates, color persistence, seq ordering, scrollback accumulation).
- `docs/superpowers/plans/2026-09-01-remart-bbs-chat.md` — Task plan for original scaffold (remart-chat/index.html, rooms.js, etc.). Out of date — repo is now React + Express standalone, not vanilla JS artifact.
- `.superpowers/sdd/remart-bbs-chat/progress.md` — Progress notes from superpowers SDD run, references Hatch artifact structure. Out of date for standalone Fly deploy.
- `docs/final-spec/Remart BBS Chat - Final Specification.md` — Approved prototype spec with explicit historical uncertainties. Still the best product intent, but V1 decisions in Section 7 (80-cell, ASCII-only, paste 20 chars, 10 cps throttling) have evolved: current code allows Unicode, no 80-cell hard limit, paste up to 100 chars, no throttling, deferred ownership on first char, empty Enters allowed, seq-ordered ops, direct WS char/backspace apply, viewer-accumulated scrollback. Treat Section 7 as superseded where it conflicts with README/server/client.

**Rule for future agents:** Do not treat any doc in `docs/superpowers/` or `.superpowers/` as source of truth. Use `server/index.js` + `client/src/App.tsx` + `README.md` as truth. If you need to update specs, update `README.md` and this file, not the historical drafts.

## Notes for future work

- Server's `/api/room-state` history is intentionally bounded (last 100) for recovery. Client accumulation since join is the scrollback. Do not increase server slice to "fix" disappearing text; fix client accumulation.
- Seq ordering guarantees: x then Backspace reordered must end empty; A Enter B must commit only A; Enter + B must render fresh buffer not HiB; remote char then immediate Backspace must be visibly applied in order via direct WS cache updates, not just refetch triggers.
