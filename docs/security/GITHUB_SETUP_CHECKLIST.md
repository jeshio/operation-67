# GitHub: действия владельца

Репозиторий и remote ещё не созданы этим этапом. Владелец создаёт новый PRIVATE repository и самостоятельно отправляет reviewed code; commit/push здесь не выполнялись.

1. Включить Actions, Issues, Dependency Graph, Dependabot Alerts и Dependabot Security Updates. Проверить поддержку pnpm lockfile. Для security updates не объединять срочные исправления с обычной группой routine-minor-patch; auto-merge не включать.
2. Включить GitHub web notifications для security Issues и failures. Telegram, внешний почтовый сервис и heartbeat не настраивать. Пользовательские email-настройки аккаунта этот код не меняет.
3. Default branch main. Разрешить необходимые закреплённые actions; GITHUB_TOKEN по умолчанию read-only. Workflows повышают только конкретные права jobs. Не давать PR production secrets. Проверить fork/Dependabot PR с минимальными permissions.
4. Запустить вручную CI, Security Watcher и Security Watchdog. Проверить отчёты, успешные статусы, загрузку artifact и отсутствие пустого «успеха» при недоступном scanner. На отдельной тестовой ветке/fixture проверить создание, обновление, отсутствие дубликатов и закрытие Issue. Не внедрять заведомо уязвимую зависимость в main ради проверки.
5. Защитить main: PR/review, required `CI / verify`, запрет force push/delete, ограничение bypass, актуальная ветка перед merge — насколько позволяет тариф приватного репозитория. Проверить фактическое имя required check после первого запуска.
6. Secret scanning, push protection, CodeQL и платный Dependency Review включить, если доступны. Бесплатная обязательная база — Gitleaks всей истории и текущего snapshot, actionlint, Semgrep CE и собственное сравнение dependency graphs. Не заявлять доступность платных функций без проверки тарифа. [Dependency Review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review).
7. Настроить artifact retention/квоту Actions и проверить расписание. Watchdog не обнаружит полную остановку Actions. Не хранить credentials в report/artifact.
8. Совместно со вторым мастером настроить production environment с approval, ограниченный deploy доступ и workflows deploy/rollback/verification/maintenance по SERVER_MASTER_HANDOFF. До этого CI только строит и проверяет.

Обновления Dependabot еженедельные для npm/pnpm, GitHub Actions и Docker root, лимиты обычных PR 5/3/3. Группа minor/patch применяется только к version updates. Security update может потребовать manual review и отдельного major-плана.
