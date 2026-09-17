# Базовая проверка безопасности — 17.09.2026

**Статус: ГОТОВ С ПРЕДУПРЕЖДЕНИЯМИ к ревью и передаче серверному мастеру. Готовность production не подтверждена.**

Изменения находятся только в рабочем дереве `/Users/jeshio/dev/operation-67`. Исходная точка: чистый main, `cd9039bd9562263dea14140f5219c418f8e4ce29`, без GitHub remote. Commit, push, merge, создание репозитория/Issues, изменение удалённых настроек, SSH, проверка публичного приложения и deployment не выполнялись. Все сетевые игровые тесты относятся к локальным процессам/контейнерам. Расчёт боя у игрока и прямой WebRTC сохранены.

## Среда и исходные проверки

Системный Node 20.19.3 не менялся. Для проверок использован официальный Node 24.21.0 darwin-arm64 в игнорируемом `.tools/`, сверенный с официальным SHASUMS256; SHA-256 архива `bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057`. pnpm 10.33.2. Новые npm-зависимости, overrides и major upgrades не добавлены; lockfile и политика esbuild-only в pnpm-workspace.yaml сохранены.

До изменений: 198 тестов PASS под Node 24, production build PASS. Обычный файловый sandbox не позволял части тестов слушать локальный порт; повтор в разрешённой локальной среде завершился успешно. Существующее предупреждение Vite о chunk >500 КБ осталось; это не новая security-находка.

Инструменты: Gitleaks 8.30.1, actionlint 1.7.12 — проверенные SHA-256 официальных релизов; Semgrep CE 1.177.0 — закреплённый digest. Значения находятся в scripts/security/tools.json. Node/Caddy/контейнеры тестов и GitHub Actions закреплены digest/SHA; четыре action SHA сверены с официальными Git tags. Semgrep не отправлял исходники в сеть, telemetry отключена. Реальные `.env`, ключи, глобальные настройки и browser profiles не читались.

## Изменения и результат

| Находка/задача | Что изменено | Подтверждение |
|---|---|---|
| Обход приглашения через публичный Colyseus matchmaking | Внешние `/matchmake*` закрыты, внутренние вызовы сохранены, private flag задан | Негативные HTTP-тесты всех методов, личная комната и штатный вход по коду |
| Некорректный WebRTC payload мог попасть в plugin без проверки | Структура/размер/тип, зарегистрированный отправитель и участник-адресат проверяются до plugin | null, массивы, неверный SDP, oversized, чужая комната; сервер продолжает работать |
| Неограниченная частота и очередь входов | Bounded token buckets, точные доверенные proxy IP, 64 pending, deadline 5 с | 429 + Retry-After, spoofed XFF, заполнение/отмена/таймаут очереди; четыре игрока за одним IP |
| HTTP/browser boundary | Единая Origin policy, CSP/headers, запрет QA в production, dotfiles/traversal/внешние и скрытые symlink targets | HTTP/WS тесты, production assets в Chromium без CSP violations |
| Нет release identity/readiness/drain | Встроенный full SHA и dirty, manifests, /ready, SIGUSR2/SIGHUP, shutdown deadline 10 с | Запуск распакованного runtime, неверный SHA/неготовность выявляются, SIGTERM завершается |
| Неизвестный состав выпуска/опасная распаковка | Runtime-only архив, 152 пакета, inventory/integrity/SHA-256, bounded byte snapshot и безопасный extractor | Тесты traversal/absolute/duplicate/device/hardlink/symlink/secret, в том числе PYTHONOPTIMIZE=1 |
| Root import архива и непроверенный rollback | Импорт удалён; доверенный helper, drain, проверка точного SHA после deploy/rollback | Одноразовый контейнер с подменёнными systemctl/curl; payload специально бросает ошибку при исполнении и не исполняется |
| Нет постоянной защиты | CI, Dependabot, watcher, watchdog, AGENTS/CLAUDE, runbooks | actionlint, fixture tests, локальные scanners; реальный GitHub запуск ещё предстоит |

Небольшое сопутствующее изменение `src/simulation.ts` добавляет пробелы и записывает `.52` как `0.52` в прежнем условии. Поведение не меняется; это устраняет неоднозначность для parser Semgrep. Общий новый линтер не вводился. Единственное Gitleaks-исключение — точно проверенное публичное имя localStorage `roma-operation-67-v1` в src/storage.ts; ни один commit/каталог целиком не исключён.

## Итоговые проверки

| Проверка | Результат / evidence в test-artifacts/security |
|---|---|
| pnpm verify | PASS: 214 тестов, 0 failed/skipped; typecheck, build, artifact check — verify.log |
| Дополнительные tests для scanner/archive | PASS, включая cursor pagination, medium→moderate, unknown applicability, сбой доставки и Python optimization |
| Native архив на macOS | PASS: package.log, archive.log; запуск и создание комнаты с чтением Node только из распакованного каталога (без fallback в node_modules проекта), неправильный SHA, drain/resume/stop |
| Linux arm64 архив | PASS: linux-package-build.log, linux-archive.log; распакован и запущен от пользователя node в контейнере без сети |
| Docker build и runtime smoke | PASS: docker-build.log, docker-smoke.log; USER node, read-only, cap-drop, без внешней сети |
| Browser Chromium 151.0.7922.34 в Linux | PASS: browser.json, browser-container.log, browser.png; два игрока, UI/WebGL, host Worker, direct WebRTC, AudioContext running и WAV 200, 0 CSP violations/JS errors |
| Gitleaks всей истории, рабочего snapshot и dist/dist-server | PASS: 0 настоящих секретов; secrets-history.json, secrets-working.json |
| Semgrep CE | PASS: 5 локальных правил, 81 TS/JS файл, 100% parsing, 0 findings/errors; semgrep.json и tools.log |
| actionlint, bash -n, compose config, diff whitespace | PASS; actionlint без shellcheck/pyflakes, их запуск не заявляется |
| Release/rollback в изоляции | PASS: release-container.log — неверная SHA, занятые комнаты, drain/cancel, замена комплекта/лимита, явный и автоматический rollback, неправильный SHA работающей версии |
| Dependency review | PASS на неизменившемся графе base=head; fixtures проверяют источники/формат. Реальный PR с новым пакетом ещё не запускался |
| npm dependency audit | ВЫПОЛНЕН: high=0, critical=0, moderate=1, low=1; dependencies.json, dependencies.log |
| Полный watcher npm + Actions | НЕ ВЫПОЛНЕН ПОЛНОСТЬЮ: npm выполнен, GitHub API GET 403 без авторизованного токена; watch.json имеет state=not_checked, exit 2 |

Два оставшихся advisory: elliptic 6.6.1 / GHSA-848j-6mx2-7j84 (low, исправление не указано) и uuid 8.3.2 / GHSA-w5hq-g745-h8pq (moderate, >=11.1.1 через major). Они приходят через неиспользуемую приложением auth/OAuth-цепочку Colyseus; request-oauth использует uuid.v4 без buffer. Подробная оценка и действия — VULNERABILITY_RESPONSE.md. Advisory не подавлены, «нулевая уязвимость» не заявляется.

Полный Actions advisory scan не объявлен успешным по отдельным удачным HTTP-ответам: часть запросов GitHub возвращала 403. Исправлены выявленные различия реального API (cursor pagination и medium severity), проверены fixtures и version-tag matching. Для полного подтверждения нужен запуск workflow с его штатным минимальным GITHUB_TOKEN после создания репозитория.

## Локальные артефакты и ограничения

`test-artifacts/roma67-vps.tar.gz` (darwin-arm64) и `test-artifacts/roma67-vps-linux-local.tar.gz` (linux-arm64) с отдельными `.sha256` предназначены для локального ревью/тестов. Оба содержат исходный commit SHA и **dirty=true**, поскольку по поручению commit запрещён. `release.sh` их не принимает. Первый production artifact должен быть построен чистым Linux CI для архитектуры проверенного VPS; текущее состояние рабочего дерева не выдаётся за существующий Git commit.

На macOS direct WebRTC не завершал ICE, хотя offer/answer/candidates проходили, AudioContext работал и CSP нарушений не было. Тот же сценарий прошёл в Linux-контейнере. В browser fixture отключён внешний STUN; интернет-NAT/STUN, Safari/Firefox и физические телефоны после этих изменений не проверялись. Нагрузочный capacity/DDoS прогон и реальная вместимость VPS не подтверждены.

Gitleaks, локальные пять Semgrep rules и 214 тестов не являются доказательством отсутствия всех уязвимостей. ОС/VPS/Caddy/сертификаты/log retention, признаки возможного взлома на сервере, runtime patch policy и резервные копии остаются вне этого этапа. Клиент-хост по-прежнему может мошенничать, а WebRTC раскрывает сетевые адреса участникам — это зафиксировано в THREAT_MODEL.md.

Workflows созданы, но ещё ни разу не запускались в GitHub. Не проверены реальная выдача прав токену, создание/дедупликация/закрытие Issues, расписание, required checks и доступность платных GitHub security features. Их не следует считать работающей защитой до приёмки владельцем. Отключение всего Actions не обнаруживается watchdog внутри Actions.

## Следующие действия владельца и второго мастера

Владелец создаёт приватный репозиторий, самостоятельно делает commit/push, включает необходимые функции и запускает workflows по GITHUB_SETUP_CHECKLIST.md. Затем второй мастер проводит аудит VPS и устанавливает ограниченного deployment-пользователя, production approval, доверенные scripts и deploy/rollback/verification/maintenance workflows по SERVER_MASTER_HANDOFF.md. Перед первым переходом с legacy версии требуется отдельная безопасная процедура; текущий release.sh сознательно отказывает версии без manifest/drain.
