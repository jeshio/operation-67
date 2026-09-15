#!/bin/sh
set -u
report_dir=test-artifacts/capacity
expect_output=false
for arg in "$@"; do
  if [ "$expect_output" = true ]; then report_dir=$arg; expect_output=false; continue; fi
  case "$arg" in --output) expect_output=true ;; --output=*) report_dir=${arg#--output=} ;; esac
done
mkdir -p "$report_dir/logs"
for pair in baseline:relay current:relay current:mixed current:direct; do
  version=${pair%:*}; route=${pair#*:}
  printf '%s\n' "Starting $version / $route"
  started=$(date +%s)
  sh scripts/capacity/run-container.sh --suite --deploy --resume --version "$version" --route "$route" "$@" \
    > "$report_dir/logs/$version-$route.log" 2>&1
  result=$?
  if [ "$result" != 0 ]; then
    # Link/generator limits still permit the other independent route series.
    node --input-type=module - "$version" "$route" "$started" "$report_dir" <<'JS'
import { readFileSync,statSync } from 'node:fs';
const [version,route,started,output]=process.argv.slice(2),path=`${output}/${version}-${route}-series.json`;
try{
 const r=JSON.parse(readFileSync(path));
 if(statSync(path).mtimeMs<Number(started)*1000||['production','telemetry','setup-or-runtime'].includes(r.limitedBy))process.exit(1);
}catch{process.exit(1);}
JS
    if [ "$?" != 0 ]; then printf '%s\n' 'Series interrupted; inspect its saved report before continuing.'; exit 1; fi
  fi
done
