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
