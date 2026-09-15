#!/bin/bash
set -euo pipefail
ROOT=/opt/roma-operation-67
ARCHIVE=${1:?Укажите архив готовой игры}
CADDY_ARCHIVE=${2:?Укажите проверенный архив Caddy}
[[ $EUID == 0 ]] || { echo 'Запустите с sudo'; exit 1; }
[[ ! -e $ROOT ]] || { echo "$ROOT уже существует; остановка без перезаписи"; exit 1; }
! getent passwd roma67 >/dev/null || { echo 'Пользователь roma67 уже существует'; exit 1; }
for unit in roma67-game roma67-https; do
  [[ ! -e /etc/systemd/system/$unit.service ]] || { echo "Служба $unit существует"; exit 1; }
done
! ss -H -ltn 'sport = :443 or sport = :5179' | grep -q . || { echo 'Порт игры занят'; exit 1; }
printf "527fbf917c39189a1e3b31d34fa955601680b2d5c8055d2a87b8b9588dec7bb9  %s\n" "$CADDY_ARCHIVE" | sha256sum -c -
mkdir -m 755 "$ROOT"
tar --no-same-owner -xzf "$ARCHIVE" -C "$ROOT"
mkdir -m 755 "$ROOT/bin"
tar --no-same-owner -xzf "$CADDY_ARCHIVE" -C "$ROOT/bin" caddy LICENSE README.md
chmod 755 "$ROOT"
[[ $(cat "$ROOT/.managed-by") == roma-operation-67-v1 ]]
useradd --system --user-group --home-dir "$ROOT" --no-create-home --shell /usr/sbin/nologin roma67
install -d -o roma67 -g roma67 -m 700 "$ROOT/data"
install -d -m 750 "$ROOT/logs"
chown -R root:root "$ROOT/bin" "$ROOT/dist" "$ROOT/dist-server" "$ROOT/node_modules" "$ROOT/deploy"
chmod 755 "$ROOT/bin/caddy" "$ROOT/uninstall.sh"
runuser -u roma67 -- env XDG_DATA_HOME="$ROOT/data" XDG_CONFIG_HOME="$ROOT/data/config" "$ROOT/bin/caddy" validate --config "$ROOT/Caddyfile" --adapter caddyfile
install -m 644 "$ROOT/deploy/vps/roma67-game.service" /etc/systemd/system/roma67-game.service
install -m 644 "$ROOT/deploy/vps/roma67-https.service" /etc/systemd/system/roma67-https.service
systemd-analyze verify /etc/systemd/system/roma67-game.service /etc/systemd/system/roma67-https.service
systemctl daemon-reload
systemctl enable --now roma67-game.service
curl --fail --silent --retry 8 --retry-connrefused --retry-delay 1 http://127.0.0.1:5179/health
# Existing HTTP denial and other service rules are left in place.
if ! ufw status | grep -F '89.19.211.4 443/tcp' | grep -q ALLOW; then
  ufw allow proto tcp from any to 89.19.211.4 port 443 comment 'roma-operation-67 HTTPS'
  touch "$ROOT/.firewall-created"
fi
systemctl enable --now roma67-https.service
printf '\nInstalled: https://89.19.211.4/\nRemove: sudo /opt/roma-operation-67/uninstall.sh --remove\n'
