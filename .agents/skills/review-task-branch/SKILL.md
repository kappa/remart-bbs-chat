---
name: review-task-branch
description: Use when reviewing commits made by another agent, reviewing a task branch or a day's merges, or when a simpler agent must get its change reviewed before committing
---

# Review a task branch

## Overview

Work here is done by several agents on separate branches, and reviewed by a
stronger model before or after landing. Review one branch stack at a time and
report per commit; a combined range diff across stacks hides which task
introduced what.

## Reviewing as the stronger model

1. Split the range by stack: `git log --graph --oneline --decorate` and take
   each `task-NN` branch (or each merge into master) separately.
2. For each stack, read the diff commit by commit, then the whole stack
   against master. Read the TODO task and any spec in
   `docs/superpowers/specs/` it came from (or `docs/archive/superpowers/`
   once the work has landed).
3. Report findings grouped by commit or task, most severe first, each with
   file, function, the failing input, and the fix. Say what was refuted too.
4. Fixes go in as new commits. Put a fix right after the commit it fixes
   only when Alex asks for that; otherwise commit at the tip of the branch,
   or on master if the stack has landed.

Checks that have caught real defects in this repo:

- Master red after a merge: tests, `typecheck`, and `check-browser.mjs`
  still asserting a removed command or an old payload shape.
- Lookup tables as plain objects: `COMMANDS[text]` matches `constructor`
  and `__proto__`; use own-property checks or a `Map`.
- Refs written during render in `App.tsx`; assign them in an effect.
- Two meanings for one word (presence as liveness and as visibility);
  keep `docs/PROTOCOL.md` vocabulary.
- Pending keystrokes when a client-side edit (autocomplete pick) is applied
  on top of unacked echo.

## Getting a review as a simpler agent

Before committing a task, call Claude as a one-shot reviewer and act on its
bullets:

```sh
claude --model claude-fable-5 -p "You are doing a read-only code review. Do not modify anything. Review this change for task NN (<title>): <two sentences on what changed and why, what tests were added, which docs changed>. Repo rules: tests verify observable behavior, one task per change, no unrelated edits, docs updated in the same commit. Reply with at most 8 short bullet findings (bugs, risks, rule violations), or the single line NO ISSUES. Diff: $(git diff master...HEAD)"
```

Paste the reviewer's bullets and what you did about each into the report.
If the review was skipped, say so; do not imply it happened.

## Common mistakes

- One diff from yesterday to today across several stacks.
- Findings with no file and function, or no input that triggers them.
- Reporting "reviewed" when the CLI call failed or was not made.
