---
name: manual-test-server
description: Use when Alex asks to start, run, or launch the app so he can test it by hand, asks how to test master locally, or asks to stop or kill a server that was started for him
---

# Start a server for manual testing

## Overview

Alex tests in real browsers and reports what he sees. Give him a running,
freshly built server and a URL, then stop it when he is done. A server left
running after the session is a defect.

## Start

```sh
npm --prefix client run build
PORT=3000 nohup npm start > /tmp/remart-bbs-chat-server.log 2>&1 &
echo $! > /tmp/remart-bbs-chat-server.pid
sleep 1 && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/
```

Report:

- URL: `http://localhost:3000/`
- Two-tab test: `http://localhost:3000/?name=Alice&room=1` and
  `http://localhost:3000/?name=Bob&room=1`. The `?name=` override does not
  change the remembered handle; `?silent=1` starts with sound off (task 41,
  once landed).
- Log: `/tmp/remart-bbs-chat-server.log`
- Which branch is served (`git rev-parse --abbrev-ref HEAD`), because the
  server serves the working tree's `client/dist`.

After a client change, rebuild and tell Alex to reload; after a server
change, stop and start again.

## Stop

```sh
kill "$(cat /tmp/remart-bbs-chat-server.pid)" && rm /tmp/remart-bbs-chat-server.pid
```

Stop when Alex says stop, when he says he is done, and before ending the
session. If the pid file is gone, `pkill -f 'node server/index.js'`.

## While he tests

Alex will report improvements and confirmations as he goes. File each
improvement as a task (`write-task` skill) and each confirmation through the
`sync-github-issues` skill; do not start implementing while he is testing
unless asked.
