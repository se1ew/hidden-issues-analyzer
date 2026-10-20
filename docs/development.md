# Разработка и воспроизводимая установка

20 октября: порты PostgreSQL/Redis в dev compose привязаны к `127.0.0.1`.
Разработка с host-процессами работает через localhost; другие устройства LAN
не получают доступ к БД и очереди. Production compose не публикует эти порты.

11 октября 2026. Команды выполняются из корня репозитория; пути внутри npm
scripts относительные. Рабочие `.env` не копируются поверх существующих файлов.

## Версии

| Компонент | Требование проекта | Проверено в этой сессии |
| --- | --- | --- |
| Node.js | 24.x; `.nvmrc` задаёт 24.19.0 | 24.19.0, Windows x64 |
| npm | 10.x или 11.x | 10.9.4 |
| PostgreSQL | 16.x | 16.15, `postgres:16-alpine` |
| Redis | 7.x | 7.4.11, `redis:7-alpine` |
| Prisma / Prisma Client | Зафиксированы lockfile | 5.22.0 |
| TypeScript / Vitest / Vite | Зафиксированы lockfile | 5.9.3 / 2.1.9 / 5.4.21 |
| ESLint | 9.x, flat config | 9.39.4 |
| Docker Desktop / Compose | Linux containers, Compose с `up --wait` | 4.94.0 / 5.5.1 |

Другие версии Node в этой сессии не проверялись. `engine-strict` предотвращает
установку вне заявленного диапазона. `.npmrc` задаёт кэш `.cache/npm` на диске
проекта: это устранило наблюдавшийся `EXDEV` при переименовании скачанного
prebuild `sharp` в общем Windows-кэше. В кэше нет исходников проекта;
он исключён из Git. Манифесты и `package-lock.json` хранятся в Git вместе.

## Установка

```powershell
node --version
npm --version
npm ci
npm run docker:up
# Создать отсутствующие .env по .env.example, вписать собственные секреты.
# Для API нужны DATABASE_URL, REDIS_URL, JWT-секреты и ключ провайдера.
npm run db:generate
npm run db:deploy
npm run db:check
npm run check
npm run dev
```

`db:generate` нужен после чистой установки: монорепозиторий хранит Prisma schema
в `apps/api/prisma`, а стандартный postinstall Prisma Client не генерирует
готовый клиент по этой схеме автоматически. Пропуск шага приводит к ошибкам
типов `Sentiment`/`ReviewWhereInput`. Генерация сама не подключается к БД.
`db:deploy` применяет сохранённые миграции к новой/существующей базе.
`db:migrate` используется разработчиком только при изменении schema.prisma.
Перед миграцией базы с ценными данными необходима проверенная резервная копия.

## Команды

| Команда | Назначение |
| --- | --- |
| `npm run dev` | API, web и worker параллельно |
| `npm run dev:api` / `npm run dev:web` / `npm run dev:worker` | Отдельный dev-процесс |
| `npm run typecheck` | TypeScript обоих workspace и конфигов web без генерации JS |
| `npm run lint` | ESLint API и web с общей flat config |
| `npm test` | API и web тесты параллельно |
| `npm run test:integration:runs` | Сборка API и отдельные временные PostgreSQL/Redis + worker; нужен Docker в PATH |
| `npm run check` | typecheck → lint → test → build |
| `npm run build` | API, затем web; web-конфиги не генерируют JS рядом с исходниками |
| `npm run start:api` / `npm run start:worker` | Собранные API / worker |
| `npm run preview:web` | Локальная проверка web production build |
| `npm run db:generate` / `db:deploy` / `db:migrate` | Клиент / существующие миграции / новая миграция |
| `npm run db:check` | Read-only проверка схемы PostgreSQL и Redis PING |

`typecheck:api`, `typecheck:web`, `lint:api`, `lint:web`, `test:api`, `test:web`,
`build:api`, `build:web` запускаются и напрямую из корня. В каталоге workspace
доступны `npm run typecheck`, `lint`, `test`, `build`.
При test:watch используется `npm run test:watch` в соответствующем workspace.

## Worker

Отдельный `src/worker.ts` выполняет BullMQ-задания, API сохраняет запуск и
снимок в PostgreSQL. Команды dev:worker/start:worker используют ту же
конфигурацию apps/api/.env. Настройки lease, доставки, ограничения и проверки
описаны в [analysis-worker.md](analysis-worker.md).

## Проверка 11 октября 2026

Проверка `npm ci` выполнена в отдельном каталоге без исходного node_modules,
с манифестами и lockfile из рабочей версии. Установлено 845 пакетов с обычными
install scripts (включая native sharp). Реальные ключи/.env туда не переносились.
После генерации Prisma Client в чистом экземпляре прошёл полный `npm run check`.

Для проверки инфраструктуры использован отдельный Compose-проект
`hia-install-check` с временными PostgreSQL и Redis и случайными портами
на 127.0.0.1. Пользовательская база и её volumes не изменялись.
Все три миграции применились на пустой БД; Redis вернул PONG.
HTTP smoke: health, регистрация, JWT `/auth/me`, ручной импорт, чтение отзыва
и фильтр по товару. Модель и Wildberries в smoke не вызывались.
В чистом экземпляре первоначально прошли 24 API + 3 web теста. После дополнения
валидации окружения добавлены 16 тестов конфигурации; итоговый `npm run check`
также прошёл (40 API + 3 web теста и обе сборки). Набор проверяет текущее
поведение, а не будущую реализацию всех API-контрактов.

## Проверка переменных при старте

API до создания сервера проверяет `env.schema.ts`: диапазон порта 1..65535,
протоколы PostgreSQL и Redis, HTTP(S)-адреса, непустые модели, положительные
лимиты, JWT-секреты от 32 символов и различие access/refresh секретов.
TTL задаётся положительным целым числом с суффиксом s/m/h/d, например `15m`.
API-ключ-заглушка из шаблона отклоняется; в production также отклоняются
JWT-секреты `change_me_...`. Отсутствующая/неверная конфигурация завершает API
с кодом 1 и сообщениями по именам полей, без вывода значений секретов.
Правильный формат ключа не подтверждает его действительность у провайдера.
Шаблоны намеренно требуют замены заглушек и не используются как готовые секреты.
Тесты проверяют все поля обоих API-шаблонов и реальные правила схемы.

Docker первоначально не запускался из-за файла сокета Secrets Engine.
После остановки процессов и повторного обычного запуска сервер стал доступен;
данные Docker не сбрасывались. Это локальная неисправность окружения, а не
ошибка Compose или приложения.

Сборка выдаёт предупреждения о размере web-бандла и возрасте Browserslist;
они не мешают сборке. npm сообщает об устаревших транзитивных зависимостях
и multer 1.x. Обновление зависимостей требует отдельной проверки совместимости.
Модели эмбеддингов, GPU, отключённый интернет и качество LLM пока не проверены.

Настройка тестов и её ограничения: [test-audit.md](test-audit.md).
Основания для конфигурации: [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/),
[ESLint flat config](https://eslint.org/docs/latest/use/configure/configuration-files),
[Vitest setupFiles](https://v2.vitest.dev/config/#setupfiles).

## Актуальные проверки 20 октября 2026

Node 24.19.0; `npm run check` проходит на текущем рабочем дереве.
`test:integration:access`, `test:integration:migration`, `test:integration:runs`
используют собственные временные PostgreSQL/Redis; проверка готовности PostgreSQL
идёт по TCP, чтобы не принять временный сервер инициализации за рабочий.
`test:production:web` проверяет сборку и SPA-маршруты. CI добавлен в
`.github/workflows/ci.yml`; удалённый запуск GitHub требует публикации изменений.
Состояние задач: [backlog-audit.md](backlog-audit.md).
