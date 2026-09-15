#!/bin/bash
set -euo pipefail
ROOT=/opt/roma-operation-67
[[ $EUID == 0 && $(cat "$ROOT/.managed-by") == roma-operation-67-v1 ]]
MODE=${1:-up}
if [[ $MODE == up ]]; then
  [[ $(node -p 'Number(process.versions.node.split(".")[0])') -ge 22 ]]
  RUNTIME=${2:?runtime archive}; CLIENT=${3:?QA client archive}
  install -d -m 755 "$ROOT/qa"
  if systemctl is-active --quiet roma67-qa; then
    health=$(curl -fsS http://127.0.0.1:5209/health)
    node -e 'if(JSON.parse(process.argv[1]).rooms!==0){console.error("На стенде есть комнаты. Дождитесь их завершения.");process.exit(1)}' "$health"
    systemctl stop roma67-qa
  fi
  tar --no-same-owner -xzf "$RUNTIME" -C "$ROOT/qa"
  tar --no-same-owner -xzf "$CLIENT" -C "$ROOT/qa/dist"
  chmod 755 "$ROOT/qa" "$ROOT/qa/dist"
  systemd-run --unit=roma67-qa --collect --property=User=roma67 --property=Group=roma67 \
    --property=MemoryMax=512M --property=CPUQuota=60% --property=TasksMax=64 --property=RuntimeMaxSec="${QA_RUNTIME_SECONDS:-7200}" \
    --working-directory="$ROOT/qa" --setenv=NODE_ENV=production --setenv=HOST=127.0.0.1 \
    --setenv=PORT=5209 --setenv=MAX_ROOMS="${QA_MAX_ROOMS:-32}" --setenv=GAME_QA=1 \
    --setenv=ALLOWED_ORIGINS=https://67.jeshio.ru,https://89.19.211.4 \
    /usr/bin/node --max-old-space-size=384 "$ROOT/qa/dist-server/index.js"
  curl -fsS --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:5209/health
fi
python3 - "$ROOT/Caddyfile" "$MODE" <<'PY'
import pathlib,sys,re,datetime
p=pathlib.Path(sys.argv[1]);s=p.read_text();s=re.sub(r'\n\t# BEGIN COLYSEUS QA\n.*?\n\t# END COLYSEUS QA\n','\n',s,flags=re.S)
if sys.argv[2]=='up':
 s=s.replace('\treverse_proxy 127.0.0.1:5179','\t# BEGIN COLYSEUS QA\n\thandle_path /qa-colyseus/* {\n\t\treverse_proxy 127.0.0.1:5209\n\t}\n\t# END COLYSEUS QA\n\treverse_proxy 127.0.0.1:5179')
p.with_name('Caddyfile.qa-next').write_text(s)
PY
runuser -u roma67 -- env XDG_DATA_HOME="$ROOT/data" XDG_CONFIG_HOME="$ROOT/data/config" "$ROOT/bin/caddy" validate --config "$ROOT/Caddyfile.qa-next" --adapter caddyfile
cp "$ROOT/Caddyfile" "$ROOT/Caddyfile.before-qa-reload"
mv "$ROOT/Caddyfile.qa-next" "$ROOT/Caddyfile"
systemctl kill --kill-who=main --signal=SIGUSR1 roma67-https
if [[ $MODE == down ]]; then systemctl stop roma67-qa || true; fi
curl -fsS --retry 3 --retry-delay 1 https://67.jeshio.ru/health
