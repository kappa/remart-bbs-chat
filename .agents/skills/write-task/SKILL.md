---
name: write-task
description: Use when adding a task to TODO.md, expanding a task for a simpler agent, or adding guidelines, guardrails, and success criteria to a task
---

# Write a TODO task

## Overview

Tasks are executed by small models that have only `TODO.md`, `AGENTS.md`,
and the repository. A task is complete when such an agent can finish it
without asking. Write the goal and the acceptance test; name the files; do
not write the code.

## Template

```markdown
## NN. Imperative title in plain words

- [ ] **Kind, area** (for example: Requested change, presence)
- **Source:** GitHub issue #N link, or where it was found and when.
- **Location:** Files and functions to read first, including the tests and
  docs that will change.
- **Requested behavior:** What the user sees or what goes over the wire,
  in USER_EXPERIENCE.md vocabulary. Name what stays the same.
- **Implementation:** The intended shape, in a few sentences: where state
  lives, which side owns it, named constants. Say which choices are the
  agent's to make.
- **Known limit:** Anything the agent might mistake for a bug and try to
  fix.
- **Acceptance:** How Alex will check it by hand in a browser, in two tabs
  when presence or echo is involved.
- **Tests:** The test files and the cases, including the existing test that
  must change. Say which suite is the test for the browser check.
- **Docs:** Which of docs/PROTOCOL.md, docs/USER_EXPERIENCE.md,
  docs/DESIGN.md, and the AGENTS.md rule list change.
```

The final commit of the task ticks the checkbox and says what was decided.

## Numbering and placement

- Numbers are stable and never reused. Take the next number.
- New issues go under a dated heading (`## New product issues imported
  YYYY-MM-DD` or `## Review issues YYYY-MM-DD`).
- Add the task to the "Recommended implementation order" table with a
  short reason for its position.
- A task solved before it was filed is still filed, ticked, for tracking.

## Common mistakes

- Writing code or diffs into the task; the agent will paste them instead
  of writing the test first.
- Leaving a decision that changes what the user sees or the wire format
  unsettled without saying "stop and ask".
- Forgetting the existing test that will start failing.
