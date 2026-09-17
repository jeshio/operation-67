#!/bin/bash
# Replace a coherent client/server/runtime set; certificates and service limits stay in place.
set -euo pipefail
ROOT=/opt/roma-operation-67
[[ $EUID == 0 && $(cat "$ROOT/.managed-by") == roma-operation-67-v1 ]] || { echo 'Нужна управляемая установка и sudo'; exit 1; }
MODE=${1:?deploy ARCHIVE [MAX_ROOMS] | rollback BACKUP}
SOURCE=${2:?Укажите архив или каталог резервной копии}
[[ $MODE == deploy || $MODE == rollback ]] || exit 2
ROOM_LIMIT=${3:-}
[[ -z $ROOM_LIMIT || ( $MODE == deploy && $ROOM_LIMIT =~ ^([1-9]|[1-5][0-9]|6[0-4])$ ) ]] || { echo 'Лимит комнат должен быть целым числом от 1 до 64'; exit 2; }
LIMIT_FILE=/etc/systemd/system/roma67-game.service.d/90-room-limit.conf
[[ $(node -p 'Number(process.versions.node.split(".")[0])') -ge 22 ]] || { echo 'Нужен Node.js 22 или новее'; exit 1; }
exec 9>"$ROOT/.release-lock"
flock -n 9 || { echo 'Другое обновление уже выполняется'; exit 1; }
STAGE=$(mktemp -d "$ROOT/.release-XXXXXX")
BACKUP=
CHANGED=0
FILES=(dist dist-server node_modules package.json)
restore_service_config(){
  [[ -d $1/service-config ]] || return 0
  if [[ -f $1/service-config/room-limit.conf ]]; then
    install -D -m 644 "$1/service-config/room-limit.conf" "$LIMIT_FILE"
  else
    rm -f -- "$LIMIT_FILE"
  fi
  systemctl daemon-reload
}
restore(){
  local code=$?
  if [[ $CHANGED == 1 && $code != 0 ]]; then
    echo "Обновление не прошло проверку. Возврат к $BACKUP"
    systemctl stop roma67-game || true
    for name in "${FILES[@]}"; do rm -rf -- "$ROOT/$name"; [[ ! -e "$BACKUP/$name" ]] || cp -a "$BACKUP/$name" "$ROOT/$name"; done
    restore_service_config "$BACKUP"
    systemctl start roma67-game || true
  fi
  rm -rf -- "$STAGE"
  exit "$code"
}
trap restore EXIT
if [[ $MODE == deploy ]]; then
  [[ -f $SOURCE ]]
  tar --no-same-owner -xzf "$SOURCE" -C "$STAGE"
  [[ $(cat "$STAGE/.managed-by") == roma-operation-67-v1 ]]
else
  SOURCE=$(realpath "$SOURCE")
  [[ $SOURCE == "$ROOT/backups/"* && -f $SOURCE/release.json ]] || { echo 'Нужна резервная копия этого скрипта'; exit 1; }
  for name in "${FILES[@]}"; do [[ ! -e "$SOURCE/$name" ]] || cp -a "$SOURCE/$name" "$STAGE/$name"; done
  [[ ! -d $SOURCE/service-config ]] || cp -a "$SOURCE/service-config" "$STAGE/service-config"
fi
if [[ -n $ROOM_LIMIT ]]; then
  mkdir -p "$STAGE/service-config"
  printf '[Service]\nEnvironment=MAX_ROOMS=%s\n' "$ROOM_LIMIT" > "$STAGE/service-config/room-limit.conf"
fi
[[ -f $STAGE/dist/index.html && -f $STAGE/dist-server/index.js && -d $STAGE/node_modules ]]
chmod 755 "$STAGE"
(cd "$STAGE" && node --input-type=module -e 'await import("./dist-server/index.js")')
HEALTH=$(curl -fsS http://127.0.0.1:5179/health)
node -e 'const h=JSON.parse(process.argv[1]);if(!h.ok||h.rooms!==0){console.error("В игре есть комнаты. Повторите обновление, когда все выйдут.");process.exit(1)}' "$HEALTH"
install -d -m 755 "$ROOT/backups"
BACKUP=$(mktemp -d "$ROOT/backups/colyseus-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
chmod 755 "$BACKUP"
for name in "${FILES[@]}"; do [[ ! -e "$ROOT/$name" ]] || cp -a "$ROOT/$name" "$BACKUP/$name"; done
mkdir -p "$BACKUP/service-config"
[[ ! -f $LIMIT_FILE ]] || cp -a "$LIMIT_FILE" "$BACKUP/service-config/room-limit.conf"
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({at:new Date().toISOString(),previousHealth:JSON.parse(process.argv[2])},null,2))' "$BACKUP/release.json" "$HEALTH"
# Check again after copying the backup; active rooms prevent any restart.
HEALTH=$(curl -fsS http://127.0.0.1:5179/health)
node -e 'if(JSON.parse(process.argv[1]).rooms!==0)process.exit(1)' "$HEALTH"
systemctl stop roma67-game
CHANGED=1
for name in "${FILES[@]}"; do rm -rf -- "$ROOT/$name"; [[ ! -e "$STAGE/$name" ]] || mv "$STAGE/$name" "$ROOT/$name"; done
restore_service_config "$STAGE"
chown -R root:root "$ROOT/dist" "$ROOT/dist-server" "$ROOT/node_modules"
systemctl start roma67-game
curl -fsS --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:5179/health
curl -fsS --retry 3 --retry-delay 1 https://67.jeshio.ru/health
CHANGED=0
printf '\nГотово. Резервная копия: %s\nИгрокам нужно перезагрузить страницы.\n' "$BACKUP"
