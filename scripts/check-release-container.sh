#!/bin/bash
set -euo pipefail
[[ -f /.dockerenv && $EUID == 0 ]] || { echo 'Run in a disposable container'; exit 1; }
ROOT=/opt/roma-operation-67
[[ ! -e $ROOT ]]
mkdir -p "$ROOT/dist" "$ROOT/dist-server" "$ROOT/node_modules" /tmp/release-bin /tmp/release-new
printf 'roma-operation-67-v1\n' > "$ROOT/.managed-by"
echo old > "$ROOT/dist/index.html"
echo 'export {}' > "$ROOT/dist-server/index.js"
echo '{"type":"module","version":"old"}' > "$ROOT/package.json"
echo old > "$ROOT/node_modules/version"
cp -a "$ROOT/." /tmp/release-new/
echo new > /tmp/release-new/dist/index.html
echo new > /tmp/release-new/node_modules/version
tar -czf /tmp/release-new.tar.gz -C /tmp/release-new .
cat > /tmp/release-bin/systemctl <<'MOCK'
#!/bin/bash
printf '%s\n' "$*" >> /tmp/release-service-commands
MOCK
cat > /tmp/release-bin/curl <<'MOCK'
#!/bin/bash
if [[ -f /tmp/release-fail && $(cat /opt/roma-operation-67/dist/index.html) == new ]]; then exit 22; fi
printf '{"ok":true,"rooms":%s}\n' "$(cat /tmp/release-rooms)"
MOCK
chmod +x /tmp/release-bin/*
export PATH=/tmp/release-bin:$PATH
echo 1 > /tmp/release-rooms
if bash /work/deploy/vps/release.sh deploy /tmp/release-new.tar.gz; then echo 'Accepted occupied rooms'; exit 1; fi
[[ $(cat "$ROOT/dist/index.html") == old && ! -f /tmp/release-service-commands ]]
echo 0 > /tmp/release-rooms
bash /work/deploy/vps/release.sh deploy /tmp/release-new.tar.gz
[[ $(cat "$ROOT/dist/index.html") == new && $(cat "$ROOT/node_modules/version") == new ]]
for file in "$ROOT"/backups/*/release.json; do backup=${file%/release.json}; done
[[ $(cat "$backup/dist/index.html") == old ]]
bash /work/deploy/vps/release.sh rollback "$backup"
[[ $(cat "$ROOT/dist/index.html") == old && $(cat "$ROOT/node_modules/version") == old ]]
touch /tmp/release-fail
if bash /work/deploy/vps/release.sh deploy /tmp/release-new.tar.gz; then echo 'Accepted unhealthy release'; exit 1; fi
[[ $(cat "$ROOT/dist/index.html") == old && $(cat "$ROOT/node_modules/version") == old ]]
[[ $(cat "$ROOT/.managed-by") == roma-operation-67-v1 ]]
echo 'PASS: occupied-room gate, coherent release, backup, explicit rollback and automatic health-failure rollback'
