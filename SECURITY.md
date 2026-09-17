# Безопасность «Операции 67»

Рабочая модель и ограничения: [THREAT_MODEL](docs/security/THREAT_MODEL.md). Результаты локальной проверки: [SECURITY_BASELINE](docs/security/SECURITY_BASELINE.md). До проверки VPS и первого успешного запуска GitHub workflows production-готовность не подтверждена.

При подозрении на уязвимость не помещайте токены, гостевые ключи, приватные IP участников, реальные `.env`, дампы и exploit против опубликованного сервера в публичные Issues. После создания приватного репозитория используйте приватный security advisory, если он доступен, или приватную Issue без секретов для владельца. Отдельный почтовый адрес и внешние сервисы уведомлений не настроены.

- [Реакция на уязвимости](docs/security/VULNERABILITY_RESPONSE.md)
- [Реакция на возможный взлом](docs/security/INCIDENT_RESPONSE.md)
- [Watcher и его ограничения](docs/security/SECURITY_WATCHER.md)
- [Настройка GitHub владельцем](docs/security/GITHUB_SETUP_CHECKLIST.md)
- [Работа агентов](docs/security/AGENT_SETUP.md)
- [Контракт приложения](docs/production/APP_CONTRACT.md)
- [Правила выпуска](docs/production/RELEASE_POLICY.md)
- [Передача серверному мастеру](docs/production/SERVER_MASTER_HANDOFF.md)

Поддерживается текущая ветка main. Предыдущий проверенный артефакт хранится для отката; это не обещание поддержки произвольных старых версий. Автоматического merge и deployment в этом наборе workflows нет.
