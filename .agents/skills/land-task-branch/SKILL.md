---
name: land-task-branch
description: Use when Alex asks to land, merge, or rebase a task branch onto master, or to clean up branches and worktrees after work has landed
---

# Land a task branch on master

## Overview

Alex decides what lands and when. Landing is: validate the rebased branch,
put it on master with the right shape, then remove the branch and worktree.
Branches are deleted only after they are on master. A previous agent deleted
two unlanded branches while "cleaning up worktrees"; do not repeat that.

## Steps

1. Show the state first, as a graph:

   ```sh
   git log --graph --oneline --decorate --date=short --format='%h %ad %d %s' master task-NN -20
   git worktree list
   ```

2. In the task's worktree, rebase onto master: `git rebase master`.
   Resolve conflicts on the branch, not on master.
3. Run the full validation on the rebased tip and read the output:

   ```sh
   npm test && npm --prefix client test && npm --prefix client run typecheck \
     && npm --prefix client run build && npm run check:browser
   ```

   Red means stop and fix on the branch. Master has been left red before by
   a merge that kept a stale test, a stale type, and a stale browser-check
   assertion; the full list catches that.
4. Land, by shape:
   - One commit on the branch: `git checkout master && git merge --ff-only task-NN`.
   - Several commits: `git merge --no-ff task-NN` is fine. If Alex asked for
     no merges, fast-forward instead.
5. Confirm: `git branch --merged master` lists `task-NN`.
6. Clean up, in this order: `git worktree remove /tmp/remart-bbs-chat-task-NN`,
   then `git branch -d task-NN` (lowercase `-d`, which refuses unmerged work).
7. Push only when Alex says push.

## Rules

- Never `git branch -D`. If `-d` refuses, the branch is not landed; stop and
  say so.
- Do not touch other task branches or their worktrees; another agent may be
  working there.
- No backup branches; if a return point matters, `git tag before-<thing>`.
- The task's checkbox tick lands with the branch. If it is missing, add it as
  a commit on the branch before landing, not on master.

## Common mistakes

- Removing a worktree and deleting its branch in the same command.
- Merging without rerunning the checks on the rebased tip.
- Pushing or deploying without being asked.
