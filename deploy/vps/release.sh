#!/bin/bash
# Trusted operator script, kept outside uploaded artifacts. Never source payload code.
set -euo pipefail
ROOT=/opt/roma-operation-67
HELPER=$(cd -- "$(dirname -- "$0")/../../scripts/security" && pwd)/archive.py
[[ $EUID == 0 && $(cat "$ROOT/.managed-by") == roma-operation-67-v1 ]] || { echo 'Нужна управляемая установка и sudo'; exit 1; }
MODE=${1:?deploy ARCHIVE EXPECTED_SHA256 [MAX_ROOMS] | rollback BACKUP}
SOURCE=${2:?Укажите архив или резервную копию}
[[ $MODE == deploy || $MODE == rollback ]] || exit 2
EXPECTED_SHA=${3:-}
ROOM_LIMIT=${4:-}
[[ $MODE != deploy || $EXPECTED_SHA =~ ^[0-9a-f]{64}$ ]] || { echo 'Нужен ожидаемый SHA-256 из доверенного CI'; exit 2; }
[[ -z $ROOM_LIMIT || ( $MODE == deploy && $ROOM_LIMIT =~ ^([1-9]|[1-5][0-9]|6[0-4])$ ) ]] || exit 2
: "${PUBLIC_ORIGIN:?Укажите HTTPS origin, который будет проверяться после обновления}"
node -e 'const u=new URL(process.argv[1]);if(u.protocol!=="https:"||u.origin!==process.argv[1]||u.username||u.password)process.exit(1)' "$PUBLIC_ORIGIN"
LIMIT_FILE=/etc/systemd/system/roma67-game.service.d/90-room-limit.conf
[[ $(node -p 'Number(process.versions.node.split(".")[0])') == 24 ]] || { echo 'Нужен Node.js 24 LTS'; exit 1; }
exec 9>"$ROOT/.release-lock"
flock -n 9 || { echo 'Другое обновление уже выполняется'; exit 1; }
STAGE=$(mktemp -d "$ROOT/.release-XXXXXX")
BACKUP= CHANGED=0 DRAINED=0
FILES=(dist dist-server node_modules package.json release.json dependencies.json integrity.json .managed-by)
health(){ curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:5179/health"; }
verify_running(){
  local expected=$1 url data
  for url in http://127.0.0.1:5179/health http://127.0.0.1:5179/ready "$PUBLIC_ORIGIN/ready"; do
    data=$(curl --fail --silent --show-error --max-time 5 --retry 5 --retry-connrefused --retry-delay 1 --retry-max-time 30 "$url") || return 1
    node -e 'const h=JSON.parse(process.argv[1]);if(h.ok!==true||h.release?.commit!==process.argv[2]||h.release?.dirty!==false)process.exit(1)' "$data" "$expected" || return 1
  done
}
restore_service_config(){
  [[ -d $1/service-config ]] || return 0
  if [[ -f $1/service-config/room-limit.conf ]]; then install -D -m 644 "$1/service-config/room-limit.conf" "$LIMIT_FILE"; else rm -f -- "$LIMIT_FILE"; fi
  systemctl daemon-reload
}
finish(){
  local code=$?
  trap - EXIT
  if [[ $CHANGED == 1 && $code != 0 ]]; then
    echo 'Проверка релиза не прошла. Возвращаем предыдущий комплект.'
    systemctl stop roma67-game || true
    for name in "${FILES[@]}"; do rm -rf -- "$ROOT/$name"; cp -a "$BACKUP/$name" "$ROOT/$name" || code=1; done
    restore_service_config "$BACKUP" || code=1
    if systemctl start roma67-game && verify_running "$PREVIOUS_COMMIT"; then echo 'Возврат предыдущей сборки проверен.'; else echo 'ОШИБКА: возврат не подтверждён. Требуется вмешательство оператора.' >&2; code=1; fi
  elif [[ $DRAINED == 1 && $CHANGED == 0 && $code != 0 ]]; then
    systemctl kill --kill-whom=main --signal=SIGHUP roma67-game || code=1
  fi
  rm -rf -- "$STAGE"
  exit "$code"
}
trap finish EXIT
if [[ $MODE == deploy ]]; then
  NEW_COMMIT=$(python3 -I "$HELPER" extract "$SOURCE" "$EXPECTED_SHA" "$STAGE")
else
  SOURCE=$(realpath "$SOURCE")
  [[ $SOURCE == "$ROOT/backups/"* && -f $SOURCE/backup.json ]] || { echo 'Нужна резервная копия этого скрипта'; exit 1; }
  for name in "${FILES[@]}"; do cp -a "$SOURCE/$name" "$STAGE/$name"; done
  NEW_COMMIT=$(python3 -I "$HELPER" verify "$STAGE")
  cp -a "$SOURCE/service-config" "$STAGE/service-config"
fi
if [[ -n $ROOM_LIMIT ]]; then mkdir -p "$STAGE/service-config"; printf '[Service]\nEnvironment=MAX_ROOMS=%s\n' "$ROOM_LIMIT" > "$STAGE/service-config/room-limit.conf"; fi
# Legacy servers may terminate on SIGUSR2: require an explicit capability first.
HEALTH=$(health)
PREVIOUS_COMMIT=$(node -e 'const h=JSON.parse(process.argv[1]);if(!h.ok||typeof h.draining!=="boolean"||h.release?.dirty!==false||! /^[0-9a-f]{40}$/.test(h.release?.commit??""))process.exit(1);process.stdout.write(h.release.commit)' "$HEALTH")
[[ -f $ROOT/integrity.json && -f $ROOT/release.json ]] || { echo 'Первый переход со старой установки выполняет серверный мастер'; exit 1; }
systemctl kill --kill-whom=main --signal=SIGUSR2 roma67-game
DRAINED=1
HEALTH=$(health)
node -e 'const h=JSON.parse(process.argv[1]);if(!h.draining||h.rooms!==0){console.error("Есть активные комнаты или режим ожидания не подтверждён.");process.exit(1)}' "$HEALTH"
install -d -m 755 "$ROOT/backups"
BACKUP=$(mktemp -d "$ROOT/backups/release-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
chmod 755 "$BACKUP"
for name in "${FILES[@]}"; do cp -a "$ROOT/$name" "$BACKUP/$name"; done
# Check saved bytes without executing the old or new artifact.
python3 -I "$HELPER" verify "$BACKUP" >/dev/null
mkdir -p "$BACKUP/service-config"
[[ ! -f $LIMIT_FILE ]] || cp -a "$LIMIT_FILE" "$BACKUP/service-config/room-limit.conf"
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({at:new Date().toISOString(),commit:process.argv[2]}))' "$BACKUP/backup.json" "$PREVIOUS_COMMIT"
HEALTH=$(health)
node -e 'const h=JSON.parse(process.argv[1]);if(!h.draining||h.rooms!==0)process.exit(1)' "$HEALTH"
systemctl stop roma67-game
CHANGED=1
for name in "${FILES[@]}"; do rm -rf -- "$ROOT/$name"; mv "$STAGE/$name" "$ROOT/$name"; done
restore_service_config "$STAGE"
chown -R root:root "$ROOT/dist" "$ROOT/dist-server" "$ROOT/node_modules"
systemctl start roma67-game
verify_running "$NEW_COMMIT"
CHANGED=0 DRAINED=0
printf 'Готово: %s. Резервная копия: %s\n' "$NEW_COMMIT" "$BACKUP"
