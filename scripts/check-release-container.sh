#!/bin/bash
set -euo pipefail
[[ -f /.dockerenv && $EUID == 0 ]] || { echo 'Run only in a disposable container'; exit 1; }
ROOT=/opt/roma-operation-67
[[ ! -e $ROOT ]]
mkdir -p /tmp/release-bin
python3 - <<'PY'
import pathlib, json, hashlib, platform, tarfile
for tag,commit,folder in [('old','a'*40,'/opt/roma-operation-67'),('new','b'*40,'/tmp/release-new')]:
 r=pathlib.Path(folder);r.mkdir(parents=True)
 for d in ['dist','dist-server','node_modules']: (r/d).mkdir()
 release={'format':1,'commit':commit,'dirty':False,'platform':'linux','arch':{'x86_64':'x64','aarch64':'arm64'}[platform.machine()]}
 for p in ['release.json','dist/release.json','dist-server/release.json']: (r/p).write_text(json.dumps(release))
 (r/'dist/index.html').write_text(tag)
 # If the release script executes archive code as root this test fails.
 (r/'dist-server/index.js').write_text('throw new Error("Payload must never execute during root validation");')
 (r/'node_modules/version').write_text(tag)
 (r/'package.json').write_text('{"type":"module"}')
 (r/'dependencies.json').write_text(json.dumps({'format':1,'commit':commit,'packages':[]}))
 (r/'.managed-by').write_text('roma-operation-67-v1\n')
 inventory={'format':1,'commit':commit,'files':{p.relative_to(r).as_posix():{'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in r.rglob('*') if p.is_file()}}
 (r/'integrity.json').write_text(json.dumps(inventory))
with tarfile.open('/tmp/release-new.tar.gz','w:gz') as t: t.add('/tmp/release-new',arcname='.')
PY
cat > /tmp/release-bin/systemctl <<'MOCK'
#!/bin/bash
printf '%s\n' "$*" >> /tmp/release-service-commands
case "$*" in
  *SIGUSR2*) echo true > /tmp/release-draining;;
  *SIGHUP*|start*) echo false > /tmp/release-draining;;
esac
MOCK
cat > /tmp/release-bin/curl <<'MOCK'
#!/bin/bash
if [[ -f /tmp/release-fail && $(cat /opt/roma-operation-67/dist/index.html) == new ]]; then exit 22; fi
python3 - <<'PY'
import json,pathlib
r=json.loads(pathlib.Path('/opt/roma-operation-67/release.json').read_text())
if pathlib.Path('/tmp/release-wrong').exists() and pathlib.Path('/opt/roma-operation-67/dist/index.html').read_text()=='new': r['commit']='c'*40
print(json.dumps({'ok':True,'rooms':int(pathlib.Path('/tmp/release-rooms').read_text()),'draining':pathlib.Path('/tmp/release-draining').read_text().strip()=='true','release':r}))
PY
MOCK
chmod +x /tmp/release-bin/*
export PATH=/tmp/release-bin:$PATH PUBLIC_ORIGIN=https://test.invalid
LIMIT_FILE=/etc/systemd/system/roma67-game.service.d/90-room-limit.conf
mkdir -p "${LIMIT_FILE%/*}"
printf '[Service]\nEnvironment=MAX_ROOMS=4\n' > "$LIMIT_FILE"
echo false > /tmp/release-draining
echo 0 > /tmp/release-rooms
SHA=$(sha256sum /tmp/release-new.tar.gz); SHA=${SHA%% *}
if bash /work/deploy/vps/release.sh deploy /tmp/release-new.tar.gz "${SHA/a/b}" 65; then exit 1; fi
if bash /work/deploy/vps/release.sh deploy /tmp/release-new.tar.gz "$(printf '%064d' 0)"; then echo 'Accepted wrong checksum'; exit 1; fi
[[ ! -f /tmp/release-service-commands ]]
echo 1 > /tmp/release-rooms
if bash /work/deploy/vps/release.sh deploy /tmp/release-new.tar.gz "$SHA" 64; then echo 'Accepted occupied room'; exit 1; fi
[[ $(cat "$ROOT/dist/index.html") == old && $(cat /tmp/release-draining) == false ]]
echo 0 > /tmp/release-rooms
bash /work/deploy/vps/release.sh deploy /tmp/release-new.tar.gz "$SHA" 64
[[ $(cat "$ROOT/dist/index.html") == new && $(cat "$ROOT/node_modules/version") == new ]]
[[ $(tail -1 "$LIMIT_FILE") == Environment=MAX_ROOMS=64 ]]
for file in "$ROOT"/backups/*/backup.json; do backup=${file%/backup.json}; done
[[ $(cat "$backup/dist/index.html") == old ]]
bash /work/deploy/vps/release.sh rollback "$backup"
[[ $(cat "$ROOT/dist/index.html") == old && $(tail -1 "$LIMIT_FILE") == Environment=MAX_ROOMS=4 ]]
for failure in fail wrong; do
 touch "/tmp/release-$failure"
 if bash /work/deploy/vps/release.sh deploy /tmp/release-new.tar.gz "$SHA" 64; then echo 'Accepted unhealthy/wrong release'; exit 1; fi
 [[ $(cat "$ROOT/dist/index.html") == old && $(cat "$ROOT/node_modules/version") == old ]]
 [[ $(tail -1 "$LIMIT_FILE") == Environment=MAX_ROOMS=4 ]]
 rm "/tmp/release-$failure"
done
rm "$LIMIT_FILE"
touch /tmp/release-fail
if bash /work/deploy/vps/release.sh deploy /tmp/release-new.tar.gz "$SHA" 64; then exit 1; fi
[[ ! -f $LIMIT_FILE && $(cat "$ROOT/.managed-by") == roma-operation-67-v1 ]]
echo 'PASS: checksum, room limit, drain/cancel, occupied rooms, release identity, explicit and automatic rollback, config restoration, no root payload execution'
