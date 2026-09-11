---
name: todo-status
description: Use when Alex asks to show, list, or table the open tasks, the recommended order, what is left, or which branch holds a task's work
---

# TODO status

## Overview

The order of open tasks is written down in `TODO.md` under
"Recommended implementation order". Report that order; never sort by task
number, priority words, or section. A previous agent sorted by number and was
sent back to read the section.

## Steps

1. Read the "Recommended implementation order" table in `TODO.md`. It lists
   only open tasks. The sentence above it names done and closed tasks, whose
   text lives in `docs/TODO_ARCHIVE.md` once they have been moved there.
2. For each open task, read its heading and first bullet to get the title,
   the kind (bug, feature, requested change) and the **Source** issue.
3. Run `git branch --list 'task-*'` and `git worktree list` to see which
   tasks have work in progress and where.
4. Print one table, in the order from step 1:

   | Order | Task | Title | Kind | Source | Work in progress |
   | --- | --- | --- | --- | --- | --- |
   | 1 | 18 | Private messages from the roster | feature | spec + plan | task-18 in /tmp/remart-bbs-chat-task-18 |

5. Below the table, one line for tasks that are done since the last commit
   touching the table, if any, so the table can be corrected.

## Vocabulary

- **done**: checkbox ticked and the change is on master.
- **closed**: decided not to do (for example WONTFIX after a root cause);
  the checkbox is ticked and the first bullet says why. Do not present a
  closed task as done.

## Common mistakes

- Sorting by task number or by "high priority" labels.
- Listing done or closed tasks in the open table.
- Reporting a task as done because its branch exists; it is done when it is
  on master and the checkbox is ticked.
