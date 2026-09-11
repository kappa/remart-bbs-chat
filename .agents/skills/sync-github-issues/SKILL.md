---
name: sync-github-issues
description: Use when Alex asks to sync, check, ingest, or close GitHub issues, to comment fixes on issues, or to turn new issues into TODO tasks
---

# Sync GitHub issues with TODO.md

## Overview

`TODO.md` is the local task list; GitHub issues on `kappa/remart-bbs-chat`
are where users report. Each task with a **Source** issue line links the two.
Sync runs both ways and ends with a commit of `TODO.md`.

## Steps

1. `gh issue list --state all --limit 200 --json number,title,state,updatedAt,comments`
   and read the tasks in `TODO.md` and `docs/TODO_ARCHIVE.md` that carry a
   **Source:** GitHub link.
2. Fixed tasks: for each task whose checkbox is ticked as done and whose
   change is on master (`git log master --oneline | grep` the task), comment
   on the issue with the master commit id and subject, then close it:

   ```sh
   gh issue comment N --body "Fixed in <sha> (<subject>). Deployed with the next release."
   gh issue close N
   ```

   Then add "GitHub issue #N closed" to the task's first bullet, in
   whichever of the two files holds the task.
3. Closed tasks (WONTFIX): comment with the root cause from the task and
   close with `gh issue close N --reason "not planned"`.
4. Open tasks: leave the issue open. If Alex reports a non-repro, comment the
   finding and ask him before closing; never close on a non-repro alone.
5. New issues without a task: add a task with the `write-task` skill under a
   heading `## New product issues imported YYYY-MM-DD`, then add it to the
   "Recommended implementation order" table with a one-line reason.
6. Open issues with comments newer than the task: fold the new information
   into the task (new bullet, or corrected behavior) and say so in the
   report.
7. Commit the task files on master unless Alex named a branch. Subject pattern:
   `Record the closed GitHub issues for tasks 25, 31, 32, and 33` or
   `Add task 42: <title>`.

## Rules

- A fix is announced on an issue only when the commit is reachable from
  master. Work on a task branch is not a fix yet.
- Alex confirms fixes on real devices; when he says a task is confirmed,
  do step 2 for it at once.
- Comments name the commit, not a chat session or a tool.

## Common mistakes

- Closing an issue because tests pass on a branch.
- Agreeing with a "no repro" without reading the code path involved.
- Adding a task without adding it to the order table.
