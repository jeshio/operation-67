#!/bin/sh
set -eu
mkdir -p test-artifacts/capacity
exec docker run --rm --init --name operation67-capacity --shm-size=1g --memory=6500m \
  -v "$PWD:/work:ro" -v "$PWD/test-artifacts:/work/test-artifacts" -w /work \
  --env-file test-artifacts/capacity/broker.env \
  -e CAPACITY_TELEMETRY_URL="${CAPACITY_TELEMETRY_URL:-http://host.docker.internal:5298}" \
  -e CAPACITY_PROXY_SERVER="${CAPACITY_PROXY_SERVER:-}" -e CAPACITY_NETWORK_PATH="${CAPACITY_NETWORK_PATH:-system-default}" \
  mcr.microsoft.com/playwright:v1.62.1-noble node scripts/capacity/run.mjs "$@"
