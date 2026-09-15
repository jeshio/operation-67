#!/bin/bash
set -euo pipefail
ROOT=/opt/roma-operation-67
if [[ ${1:-} != --remove ]]; then
  echo 'Удаление остановит игру и удалит только /opt/roma-operation-67, две службы roma67, пользователя roma67 и правило HTTPS этой игры.'
  echo 'Для удаления: sudo /opt/roma-operation-67/uninstall.sh --remove'
  exit 0
fi
[[ $EUID == 0 ]] || { echo 'Запустите с sudo'; exit 1; }
[[ ! -L $ROOT && $(cat "$ROOT/.managed-by") == roma-operation-67-v1 ]] || { echo 'Нет метки установки; удаление остановлено'; exit 1; }
for unit in roma67-game roma67-https; do
  file=/etc/systemd/system/$unit.service
  [[ -f $file ]] && cmp -- "$ROOT/deploy/vps/$unit.service" "$file" || { echo "Служба $unit изменена; проверьте её перед удалением"; exit 1; }
done
[[ $(getent passwd roma67 | cut -d: -f6) == "$ROOT" ]] || { echo 'Пользователь roma67 изменён'; exit 1; }
systemctl disable --now roma67-https.service roma67-game.service
if [[ -f $ROOT/.firewall-created ]]; then
  ufw --force delete allow proto tcp from any to 89.19.211.4 port 443
fi
rm -- /etc/systemd/system/roma67-game.service /etc/systemd/system/roma67-https.service
systemctl daemon-reload
userdel roma67
rm -rf --one-file-system -- "$ROOT"
echo 'Игра удалена. Остальные службы и правила сервера сохранены.'
