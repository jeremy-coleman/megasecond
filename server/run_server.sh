#!/bin/bash
pnpm run_server |& \
  pnpx frontail \
    --ui-highlight \
    --ui-highlight-preset server/log-highlight.json \
    --port 9002 \
    --url-path /log/server \
    -