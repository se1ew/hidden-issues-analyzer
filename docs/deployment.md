# Развёртывание рабочей сборки

Сборка: `npm ci`, `npm run db:generate`, `npm run build`.
API и worker запускаются из `apps/api` командами `npm run start` и
`npm run start:worker`. Миграции перед запуском: `npm run db:deploy`.

Для отдачи frontend самим API задайте в `apps/api/.env`:

```dotenv
NODE_ENV=production
WEB_DIST_DIR=../web/dist
```

Путь считается от рабочего каталога API. В контейнере используется абсолютный
путь. Сервер проверяет наличие `index.html` и поддерживает прямое открытие
страниц SPA; отсутствующие API и файлы возвращают 404. Хэшированные assets
кэшируются, HTML запрашивается заново. Socket.IO работает на том же HTTP-сервере.
Проверка собранного сервера: `npm run test:production:hosting`.

## Контейнеры

Скопируйте `deploy/.env.example` в `deploy/.env`, задайте независимые случайные
секреты и параметры локального runtime. Из корня:

```powershell
docker compose --env-file deploy/.env -f compose.production.yaml up -d --build
docker compose --env-file deploy/.env -f compose.production.yaml ps
docker compose --env-file deploy/.env -f compose.production.yaml stop
```

Приложение: `http://localhost:8080`. Локальная модель запускается отдельно
на Windows; `host.docker.internal` разрешается внутри контейнеров. Оба процесса
используют один собранный образ. БД и Redis доступны только внутри Docker-сети.
Docker build не получает `.env`, пользовательские загрузки, отчёты и кэши.

20 октября образ собран с Linux-зависимостями; на отдельном случайном Compose
project проверены миграции, readiness БД/Redis/worker, страницы SPA, регистрация
и создание товара. Повтор: `npm run test:production:compose` после `docker build
-t reviewlens-app:local .`. Проверка удаляет только собственный временный project.

## Данные и модели

Именованные volumes `postgres`, `redis`, `reports`, `uploads`, `models` хранят
БД, AOF очереди, отчёты, временные загрузки и модели эмбеддингов. API и worker
видят одни и те же каталоги. `EMBEDDING_CACHE_DIR=/app/models_cache` передаётся
загрузчику модели явно. GGUF и runtime Windows храните вне контейнера,
например в `D:\ReviewLens\models`; выбранный путь запишите в `docs/local-model.md`.

`stop`, `down` и пересоздание контейнеров сохраняют volumes. **`down --volumes`
удаляет данные**; используйте его только в одноразовых тестах. Не меняйте имя
Compose project при обновлении: от него зависят имена volumes. Копируйте данные
только средствами резервного копирования. Проверено полное пересоздание всех
контейнеров: запись товара, отчёты, загрузки и кэш остались доступными worker.

## Готовность и обновления

Одноразовый сервис `migrate` выполняет только `prisma migrate deploy` после
готовности PostgreSQL. API и worker стартуют после успешной миграции и Redis
PING. API healthcheck использует `/ready`, включая свежий heartbeat worker;
worker проверяет собственный heartbeat по имени контейнера. Доступность модели
проверяется отдельно и не блокирует чтение сохранённых результатов.
Повторный `up` проверен вместе с пересозданием контейнеров и повторным deploy:
миграции не запускаются в режиме разработки и повторно не изменяют данные.

## Одна команда управления Windows

Из корня проекта (Windows PowerShell 5.1 или PowerShell 7):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action Init
# В deploy/.env вписать фактический LLM_MODEL и параметры runtime.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action Build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action Start
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action Status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action Stop
```

`Init` создаёт три независимых криптографически случайных секрета и отказывается
перезаписывать существующий файл. `Start` ждёт Docker Desktop и готовность
приложения. `Stop` сохраняет данные. `Logs` показывает последние события.
Параметры `-EnvFile` и `-ProjectName` позволяют отдельное тестовое развёртывание.
Проверены Init, Status, Start, Stop и повторный Start в Windows PowerShell 5.1
на отдельном project. `ExecutionPolicy Bypass` применяется только к этому процессу.

На целевом ПК после выбора runtime подготовьте собственный PowerShell-скрипт,
который запускает runtime в фоне и возвращает управление. Установите задачу
входа текущего пользователя:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action InstallAutostart -RuntimeScript D:\ReviewLens\start-runtime.ps1
# Просмотр параметров без регистрации задачи: добавьте -WhatIf.
# Удаление только своей задачи:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action RemoveAutostart
```

Задача запускается через 30 секунд после входа; пароли в командной строке не
передаются. На основном ПК автозапуск не установлен. Проверка реального входа,
перезагрузки и GPU-runtime остаётся на втором ПК отдельным открытым пунктом.

## Ресурсы интерфейса без интернета

Noto Sans Regular/Bold и лицензия OFL входят в `apps/web/public/fonts`.
Иконка сайта также локальная. HTML и CSS не обращаются к Google Fonts.
Браузерная проверка 48 сочетаний страниц, тем и ширины подтвердила отсутствие
внешних запросов. Вход и восстановление cookie-сессии проверены на настоящем
production-сервере. Автономная работа instruct-модели проверяется отдельно.

## Один адрес для браузера и локальной сети

В production frontend и Socket.IO автоматически используют адрес открытой
страницы. Поэтому смена IP сервера не требует пересборки. Браузер обращается
к одному порту `APP_PORT`; пути `/api` и `/socket.io` обслуживает API.
`WEB_ORIGIN` должен точно совпадать с адресом в браузере, включая порт.
Cookie HttpOnly/SameSite=Lax; Secure включается только для HTTPS.

Для первоначальной установки с адресом сервера в LAN:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action Init -HostAddress 192.168.1.50 -Port 8080
```

Для существующего `deploy/.env` установите `APP_BIND=0.0.0.0` и
`WEB_ORIGIN=http://192.168.1.50:8080`, затем повторите Start. `APP_PORT` остаётся
8080. Открывайте именно этот адрес. БД, Redis и модель не адресуются из браузера.
Реальное подключение второго устройства и адрес сети демонстрации остаются
открытой проверкой целевого ПК.

Production-проверка поддерживает Playwright через `PLAYWRIGHT_MODULE` (модуль
или file URL) и `BROWSER_EXECUTABLE` (необязательный путь браузера). Она проверяет
регистрацию, refresh cookie, 48 страниц/тем/ширин и отсутствие внешних запросов.
Без этих переменных `test:production:compose` выполняет HTTP/Socket.IO проверки.

## Firewall на сервере демонстрации

Production compose публикует только `APP_PORT`; PostgreSQL и Redis не имеют
host ports. По умолчанию приложение доступно только через loopback. Для LAN
нужен `APP_BIND=0.0.0.0`, правильный `WEB_ORIGIN` и частный профиль сети Windows.
На целевом ПК в PowerShell администратора:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/firewall.ps1 -Port 8080 -WhatIf
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/firewall.ps1 -Port 8080
# Удаление только этого правила: добавьте -Remove.
```

Правило допускает TCP 8080 только с `LocalSubnet` в профиле `Private`.
Оно не открывает 4000, 5432, 6379 и 8081; эти порты нельзя выбрать как порт
приложения в скрипте. На основном ПК проверен WhatIf; системные правила не
изменялись. Runtime привязывайте к loopback и проверьте его достижимость из
контейнера через `host.docker.internal`. Не включайте публичный доступ к нему.
Если конкретный runtime требует иной привязки, ограничьте его входящие правила
Docker-соединениями и повторите проверку с другого устройства.

## Резервное копирование production

С основного каталога проекта на машине с Node и Docker CLI:

```powershell
node scripts/production-storage.mjs backup --directory D:\ReviewLens-backups\before-update
```

Команда ненадолго останавливает API/worker, делает согласованную копию БД и
каталога отчётов, записывает manifest SHA-256 и возобновляет ранее работавшие
процессы. Новый каталог backup обязателен; существующий не перезаписывается.
Секреты подключения не выводятся. Модели/runtime и `deploy/.env` храните
отдельно в защищённой копии; временные uploads не являются архивом источников.

Восстанавливайте в отдельный новый project с теми же секретами и совместимым
образом; API/worker должны быть остановлены, БД и каталог отчётов — пустыми:

```powershell
node scripts/production-storage.mjs restore --directory D:\ReviewLens-backups\before-update --env-file deploy/.env --project reviewlens-restored
```

Для параллельной проверки задайте в отдельном env-файле другой `APP_PORT` и
соответствующий `WEB_ORIGIN`. Восстановление проверяет manifest и все артефакты,
сбрасывает старые heartbeat/leases и запускает `migrate deploy`/readiness.
Команда отказывается перезаписывать существующую БД или непустые отчёты.
Не удаляйте исходную установку ради восстановления.

Проверка `test:production:compose` сохранила synthetic project, пересоздала
только его volumes и восстановила пользователя, товар и файл отчёта. Повторное
восстановление в непустую установку отклонено. Перезагрузка Windows с реальным
runtime проверяется на целевом ПК отдельно.

## Если LAN площадки недоступна

Показывайте приложение в браузере самого сервера:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action Local
```

Команда сохраняет текущий порт, устанавливает loopback и соответствующий
`WEB_ORIGIN`, затем запускает контейнеры. Секреты и данные сохраняются;
изменение env выполняется атомарно. Откройте `http://localhost:8080`
(или ранее выбранный порт). Проверены действие Local в Windows PowerShell 5.1
и готовность API/worker. Работа без интернета дополнительно требует заранее
загруженных моделей; эта команда не заменяет их проверку.
