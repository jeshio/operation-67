# Security Watcher

`security-watch.yml` запускается по понедельникам в 04:23 UTC (09:23 Екатеринбург), вручную и при изменении manifest/lock/workflows/security scripts в main. Он не устанавливает зависимости проекта и не запускает install scripts. Источники: npm audit API через pnpm (весь lockfile и отдельно --prod) и GitHub Global Security Advisories API для ecosystem=actions. Для GitHub используются официальные cursor links; severity medium приводится к moderate. Ответы проверяются по схеме; неожиданная схема означает not_checked. [API contract](https://docs.github.com/en/rest/security-advisories/global-advisories). Action SHA дополнительно сопоставляется с официальным version tag, включая annotated tags.

Структурированный отчёт `test-artifacts/security/watch.json`: format, checkedAt, SHA-256 lockfile, state, findings, errors, actions. Каждая проблема содержит advisory, пакет, версию, workspace, severity, scope runtime/build, доступность исправления и fingerprint SHA-256(advisory/package/version/workspace). Неизвестная применимость Actions явно отмечается; непонятный диапазон не считается безопасным. Npm report классифицирует scope консервативно по полному prod dependency graph, а не по фактически вызываемым функциям.

Состояния:

- `clean`: все запрошенные источники успешно проверены, проблем не найдено.
- `vulnerable`: проверка выполнена и есть findings; low/moderate сохраняются в отчёте, новая Issue создаётся только для high/critical или unknown applicability.
- `not_checked`: ошибка сети, API, неверный JSON/диапазон формата данных, отсутствие отчёта. Не считается нулём уязвимостей. Workflow завершается ошибкой, открытые проблемы не закрываются.

Scan job имеет contents:read. Отдельный notify job на main имеет issues:write, pull-requests:read и checks:read. PR job не получает права записи и production secrets. Нет pull_request_target с исполнением PR-кода. Все actions закреплены полным SHA; версия в комментарии проверяется относительно upstream tag. Reports — данные; их содержимое не выполняется.

## Уведомления

Только GitHub Issues от github-actions[bot] с машинным marker. Совпадающий результат не порождает новый Issue/комментарий. Изменение серьёзности, доступного исправления или статуса найденного Dependabot PR обновляет описание и добавляет уведомляющий комментарий; закрытая вручную всё ещё найденная проблема открывается снова. Low/moderate, ранее заведённые как high, остаются отслеживаемыми до исчезновения версии. Сбой сканера — отдельная стабильная Issue. Ошибка доставки остаётся ошибкой job и не скрывается.

Полная успешная проверка может закрыть Issue отсутствующей версии с явным текстом: исправлен/изменён проверенный checkout, состояние production неизвестно. Новая версия того же пакета может иметь собственную Issue. Удаление пакета из lockfile не доказывает отсутствие старой версии на VPS. Issue не закрывает возможный incident автоматически.

В отчёте Issue: пакет/версия, серьёзность, применимость, доступность исправления, найденный Dependabot PR, состояние его checks, требуемое действие и условие перехода в incident mode. Поиск PR по названию пакета является подсказкой: владелец проверяет реальный diff и affected version. Автоматического merge/обновления VPS нет.

## Watchdog

`security-watchdog.yml` раз в сутки в 05:41 UTC читает историю Security Watcher; dependency scan не повторяет. Если нет успешного завершения больше восьми дней либо последний завершённый запуск ошибочен, создаёт/обновляет одну Issue. Повторяющееся состояние молчит; восстановление закрывает Issue с комментарием. Нужны actions:read и issues:write. Неверный ответ API приводит к ошибке самого watchdog.

Полную остановку GitHub Actions, удаление обоих workflows, проблему GitHub/account billing или отключение уведомлений изнутри того же сервиса обнаружить гарантированно нельзя. Внешний монитор и heartbeat по выбору владельца не добавлены. Владелец периодически проверяет Actions и квоту; расписания могут задерживаться. Telegram и внешний почтовый сервис отсутствуют.

## Локальная проверка

`pnpm security:dependencies` пишет dependencies.json и возвращает 2 при сбое, 1 при high/critical, 0 при отсутствии блокирующих severity (low/moderate всё равно отображаются). `node scripts/security/watch-scan.mjs` создаёт полный watch.json; наличие findings само по себе не означает ошибку сканера. `tests/security-watcher.test.ts` проверяет дедупликацию, изменение/исчезновение проблемы, unknown, ошибку parser/доставки и stale history. Локальные тесты используют fixtures и не создают реальные GitHub Issues.

Локальный неаутентифицированный GitHub API может ограничить квоту; такой результат остаётся not_checked. В GitHub workflow используется короткоживущий GITHUB_TOKEN с указанными правами. Не передавайте личный токен в репозиторий и не выводите его в лог.

Scope watcher ограничен npm lockfile и Actions. Обновления Node/ОС, Caddy и инструментов Gitleaks/actionlint/Semgrep требуют отдельного сопровождения; Dependabot предлагает Docker updates, но это не сканер всей ОС.
