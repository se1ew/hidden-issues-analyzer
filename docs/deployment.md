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
