# Docs status

Authoritative docs for this repo:

- `README.md` — overview, testing deployment, structure, how to run.
- `docs/USER_EXPERIENCE.md` — user experience, black box: what it does.
- `docs/DESIGN.md` — design decisions: why it behaves that way.
- `docs/PROTOCOL.md` — current wire protocol and client/server exchange behavior.

These maintained docs describe the system as built. Update the relevant docs
when behavior changes, including the protocol reference for wire changes.

## Historical material (not authoritative)

The specs below are early intent, kept for archaeology. Do not treat them as
source of truth, and do not update them — update the maintained docs above instead.

- `docs/superpowers/specs/2026-09-01-remart-bbs-chat-design.md` — first draft
  (80-cell, ASCII-only, vanilla JS scaffold). Superseded Sep 3–4: Unicode, no
  length limit, deferred ownership on first char, live updates, color
  persistence, seq-ordered ops, viewer-accumulated scrollback.
- `docs/superpowers/plans/2026-09-01-remart-bbs-chat.md` — task plan for the
  original scaffold. Superseded: the repo is React + Express, not vanilla JS.
- `.superpowers/sdd/remart-bbs-chat/progress.md` — notes from the original
  spec-driven run. Historical only.
- `docs/final-spec/Remart BBS Chat - Final Specification.md` — approved
  prototype spec. Best statement of original product intent, but its Section 7
  decisions (80-cell, ASCII-only, paste cap 20, 10 cps throttle) were all
  revised during the build. Where it conflicts with the maintained docs above, the
  docs above win.

**Rule for future work:** `README.md` + `docs/USER_EXPERIENCE.md` +
`docs/DESIGN.md` + `docs/PROTOCOL.md` are truth. The implementation (`server/index.js`,
`client/src/App.tsx`) is the final arbiter when docs and code disagree — and
then the docs get fixed.
