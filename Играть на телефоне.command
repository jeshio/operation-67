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
if ! node scripts/lan.mjs; then
  print 'Игра не запустилась. Проверьте сообщение выше. Если порт 5178 уже занят игрой, используйте открытое окно запуска.'
  read '?Нажмите Enter, чтобы закрыть окно.'
  exit 1
fi
