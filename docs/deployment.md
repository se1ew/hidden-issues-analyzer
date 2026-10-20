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
