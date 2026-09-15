#!/bin/zsh
set -eu
cd -- "${0:A:h}"

runtime_dir="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
if ! command -v node >/dev/null 2>&1 && [[ -x "$runtime_dir/node" ]]; then
  export PATH="$runtime_dir:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  print 'Для запуска установите Node.js 22.12+ или 24 LTS.'
  read '?Нажмите Enter, чтобы закрыть окно.'
  exit 1
fi

if [[ ! -f node_modules/vite/bin/vite.js ]]; then
  print 'Сначала установите зависимости: pnpm install'
  read '?Нажмите Enter, чтобы закрыть окно.'
  exit 1
fi

existing_page="$(curl --connect-timeout 1 --max-time 2 -fs http://127.0.0.1:5177/ 2>/dev/null || true)"
if [[ "$existing_page" == *'Рома: операция 67'* ]]; then
  open http://127.0.0.1:5177/
  exit 0
fi

print 'Операция 67 запущена. Оставьте это окно открытым, пока играете.'
print 'Чтобы остановить игру, нажмите Control+C.'
exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5177 --strictPort --open
