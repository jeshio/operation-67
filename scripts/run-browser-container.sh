#!/bin/sh
set -eu
# Docker provides an isolated network interface, unaffected by host VPN ICE selection.
# The bind mounts contain application/test files only; no credentials or Docker socket.
image=mcr.microsoft.com/playwright:v1.62.1-noble
suffix=-container
if [ "${QA_NETWORK_FAULTS:-0}" = 1 ]; then image=operation67-network-qa; suffix=-netem; fi
docker run --rm --cap-add=NET_ADMIN --name operation67-browser-qa --shm-size=1g --memory=3g \
  -v "$PWD:/work:ro" -v "$PWD/test-artifacts:/work/test-artifacts" -w /work \
  -e QA_URL="${QA_URL:-http://127.0.0.1:5197/qa-network.html}" -e QA_LOCAL_ICE=1 -e QA_REPORT_SUFFIX="$suffix" -e QA_NETWORK_FAULTS="${QA_NETWORK_FAULTS:-0}" \
  "$image" sh scripts/qa-container-entry.sh "$@"
