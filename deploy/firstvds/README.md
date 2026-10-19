# «Операция 67» на FirstVDS

План первоначального перехода и дополнение по security-блокерам: [PLAN.md](PLAN.md).
Контракт приложения и release gates остаются обязательными.

## Размещение

- `/opt/operation-67`: отдельный Compose project `operation67`, контейнер
  `operation67-game`, непривилегированный UID/GID 1000.
- `operation67-edge`: отдельная Docker bridge сеть, 172.31.67.0/28. Caddy — .2,
  игра — .3. Только эти два контейнера; сеть не объединяется с jeshio-edge или
  openclaw_private. Проверить host routes и существующие сети до создания.
- Единственный публичный origin — `https://67.jeshio.ru`. HTTP redirect/TLS
  обслуживает существующий общий Caddy. Приложение не публикует host ports.
- Состояние комнат в памяти; рекорды, имя и настройки сохраняются в браузерах.
  Persistent data volumes игре не нужны. GAME_QA не включать.
- Лимит 64 комнаты сохранён со старого сервера, RAM 512 MiB, CPU 1, pids 128,
  read-only rootfs, cap_drop ALL, no-new-privileges, stop grace 15 s.
  Логи — json-file, 3 × 10 MiB. Это ограничения, не подтверждение вместимости.

## Первоначальная установка

1. Получить архив и ожидаемую SHA256 из успешного Linux CI конкретного commit.
   Проверить все gates, review dependency diff и remaining advisory. Не брать
   dirty/macOS archive из локальных тестов для production.
2. Сохранить архив вне Git в `/opt/operation-67/artifacts/<commit>/`. Доверенный
   `scripts/security/archive.py` установить root-owned вне payload, например в
   `/opt/operation-67/operator/archive.py`. Проверить его происхождение по
   reviewed commit. Он не импортирует и не исполняет runtime.
3. Создать пустой `releases/<commit>/runtime`, выполнить от оператора:

   ```bash
   python3 -I /opt/operation-67/operator/archive.py extract \
     /opt/operation-67/artifacts/<commit>/roma67-vps.tar.gz <ожидаемая-SHA256> \
     /opt/operation-67/releases/<commit>/runtime
   ```

4. Проверить совпадение commit/dirty=false/platform=linux/arch=x64 и manifests.
   Упаковать готовый runtime через доверенный Dockerfile.runtime. На VPS нет
   компиляции приложения, установки npm-зависимостей или RUN payload; image
   layer содержит COPY уже проверенного runtime. Сеть build — none. Сохранить
   полученный immutable image ID и `docker image save` для восстановления.
5. Создать сеть, установить Compose из этого каталога, подставив проверенный
   image ID непосредственно в серверный compose.yaml вместо шаблона. Файл
   содержит только публичные параметры, секретного `.env` у игры нет.
6. Проверить Compose и запустить игру. До DNS открыть SSH tunnel к
   `172.31.67.3:5179`, проверить `/health`, `/ready`, точный SHA, assets и закрытые
   маршруты штатным smoke с `--allow-local-http`. QA endpoints должны давать 404.
7. В постоянный Compose общего Caddy добавить external network operation67-edge
   с ipv4_address 172.31.67.2. Подключить её к живому контейнеру:

   ```bash
   docker network connect --ip 172.31.67.2 operation67-edge infra-caddy
   ```

   Сохранить приватный резерв инфраструктуры и TLS вне VPS. Установить только
   `operation67.caddy` в `/opt/infra/sites/`, затем caddy validate и reload.
   Пересоздание Caddy, сайта jeshio и OpenClaw не требуется.
8. Переключить только A record `67.jeshio.ru` на 82.146.39.112. Остальные DNS
   records сохранить. Проверить сертификат без insecure-флагов, HTTPS/WSS,
   `/health`/`/ready` с точным SHA, четыре клиента за NAT и обычный UI.
9. Старый runtime не поддерживает drain: не посылать SIGUSR2. При rooms=0
   перевести старый Caddy в HTTPS proxy нового домена с проверкой сертификата и
   `tls_server_name 67.jeshio.ru`; старый IP redirect на домен. После проверки
   остановить и disable только roma67-game.service. Радиорелей не менять.

## Обслуживание

```bash
cd /opt/operation-67
docker compose ps
docker compose logs --tail=100 game
docker compose exec -T game node -e "fetch('http://127.0.0.1:5179/health').then(r=>r.json()).then(console.log)"
```

Перед заменой образа проверить release identity, включить drain сигналом SIGUSR2,
дождаться подтверждения draining=true и rooms=0. Если комнаты заняты — SIGHUP
и отменить выпуск. Не перезапускать занятые комнаты без отдельного решения.
Сохранить прежний compose/image ID, проверить новый CI artifact, затем выполнить
`docker compose up -d --wait game` и smoke с ожидаемым SHA. При неуспехе вернуть
прежний проверенный compose/image ID, повторить health/readiness и публичный
smoke. Неуспешный rollback требует ручного вмешательства; ошибка не скрывается.

При первой миграции прежний production находится на другом VPS и не имеет
новых manifests. Аварийное восстановление — вернуть DNS/HTTPS на сохранённую
старую установку. Это ручной legacy rollback, не новая проверенная версия.

Игра не получает shell-доступ, SSH-ключи или Docker socket. GitHub workflows
собирают artifact, но не deploy. Ограниченный CI-deployer и автоматический
deployment требуют отдельной задачи; первый перенос использует существующий
административный доступ владельца.

## Резерв

До изменения старой установки создан закрытый legacy archive без access logs:
77 423 415 байт, SHA256
`ba25ca8d9a005f04aa89c980ad260c49cd4f8588fab52a0f6a5d7db018332895`.
Сверенная копия на FirstVDS:
`/var/backups/operation67/source/legacy-2026-10-19.tar.gz`, file 600, directory 700.
Внутри есть старые TLS keys: архив не коммитить, не публиковать и не загружать
как обычный незашифрованный CI artifact. Исходник пока сохранён и на старом VPS.
Полный резерв игры не входит в OpenClaw backup.

## Проверки подготовки

Локальный audit: high/critical 0 после двух patch overrides; remaining uuid
moderate и elliptic low сохранены с разбором в PLAN.md. По общему решению владельца
для проектов на FirstVDS от 19.10.2026 low/moderate не блокируют выпуск;
high/critical и scanner errors по-прежнему блокируют.
Сборка, security tools, native archive local test и release container fixtures
прошли. В native Linux/arm64 с Node 24.21.0 и pnpm 10.33.2 полный pnpm verify:
214 pass, 0 fail; build и security:artifact pass. Linux Chromium: production UI,
WebGL, host Worker, direct WebRTC, audio, CSP и отсутствие QA globals — pass.
Локальный dirty artifact не является production-артефактом; чистый Linux/x64
runtime ещё должен выпустить штатный GitHub CI после разрешённых Git-операций.

Первые локальные Mac runs не прошли из-за занятого порта 2568 и ICE loopback.
Ранний Linux browser запуск без временного XDG config завершился crashpad error;
повтор с приватными /tmp-каталогами прошёл. x64-эмуляция Docker Desktop дала сбой
esbuild Go service; она не объявляется успешной. Для локальных регрессий
использован native arm64. Подготовка runner также потребовала pnpm shim,
пишущихся XDG/store и exec на одноразовом build tmpfs; production compose этим
не менялся. Ошибки/ограничения сохранены в отчётах, проверки не отключались.
Рабочие логи находятся в `test-artifacts/firstvds/` изолированного checkout.
Production acceptance добавляется только после фактического переключения.
