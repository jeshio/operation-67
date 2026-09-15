#!/bin/sh
set -eu
[ -f /.dockerenv ] && [ "${QA_NETWORK_FAULTS:-0}" = 1 ] || exit 1
# Only disposable container interfaces; never change the host or VPS network.
if [ "${1:-on}" = off ]; then
  tc qdisc del dev eth0 root 2>/dev/null || true
  tc qdisc del dev lo root 2>/dev/null || true
else
  tc qdisc replace dev eth0 root netem delay 40ms 10ms loss 1% reorder 2%
  tc qdisc replace dev lo root netem delay 15ms 5ms loss 2% reorder 5%
fi
