#!/bin/sh
set -eu
: "${STORAGE_PASSWORD:?STORAGE_PASSWORD is required for shared Docker data}"
if [ "${#STORAGE_PASSWORD}" -lt 12 ]; then
  echo 'STORAGE_PASSWORD must be at least 12 characters' >&2
  exit 1
fi
node /opt/open-image-playground/storage-server.mjs &
STORAGE_PID=$!
sleep 1
if ! kill -0 "$STORAGE_PID" 2>/dev/null; then
  echo 'Shared storage server failed to start' >&2
  exit 1
fi
