#!/bin/sh
set -eu
node scripts/qa-container-proxy.mjs &
node scripts/check-multiplayer-browsers.mjs "$@"
