# ReviewLens

Интеллектуальная система анализа отзывов о товарах с **выявлением скрытых проблем**.

**Курсовая работа, 4-й курс.**

## Данные об авторе

- **Автор:** Сакович Евгений Сергеевич
- **Идентификатор:** sakovich_es_23
- **Курс:** 4
- **Специальность:** Искусственный интеллект
- **Вид проекта:** курсовая работа

Пользовательские данные требуют авторизации и доступны владельцу товара.
Access token хранится в памяти клиента, refresh — в HttpOnly cookie;
после перезагрузки сессия восстанавливается, выход отзывает её на сервере.
Новые импорты сохраняют происхождение; правила переходного периода и
проверки изоляции описаны в [docs/ownership.md](docs/ownership.md).
CSV загружается через предпросмотр и сопоставление колонок; товар выбирается
явно, ошибки строк можно скачать. Формат и пределы: [docs/csv-import.md](docs/csv-import.md).

## Спецификация следующей версии

- [Поведение первой версии и критерий скрытой проблемы](docs/product-spec.md)
- [25 размеченных примеров и правила проверки](docs/fixtures/README.md)
- [Сценарии приёмки и измеряемые ограничения](docs/acceptance.md)

Документы задают целевое поведение. Расхождения с текущей реализацией указаны
в спецификации. Проверить согласованность примеров: `node scripts/validate-review-cases.mjs`.

## Что умеет

- Загрузка отзывов: CSV / ручной ввод / парсинг Wildberries
- LLM-анализ: выбор OpenRouter или локальной GGUF-модели в профиле; тональность, аспекты, проблемы
- Семантическая группировка жалоб через эмбеддинги (`@xenova/transformers`) с версионированными публикациями
- Группы запусков с отдельными показателями поддержки, распространённости и положительного контекста
- Последствия с цитатами, объяснимый версионированный приоритет и серверные фильтры групп: [контракты и проверки](docs/priority-and-api.md)
- Общая область товара/периода/запуска, восстановление состояния на любой странице и доступные диалоги: [проверки интерфейса и очереди](docs/interface-and-run-sync.md)
- AI executive summary — LLM формирует краткий аналитический вывод по продукту
- Управление продуктами: фильтрация всех данных по продукту, переименование, удаление
- Стабильные карточки проблем, история решений, предпросмотр объединения и разделения групп
- Рабочие страницы: Обзор, Загрузка, Аналитика, Проблемы, Отзывы, Отчёты, Товары, Профиль; Wildberries находится в «Загрузка»
- Real-time прогресс анализа через Socket.IO
- Экспорт PDF / DOCX отчётов
- Dark mode, мобильный sidebar с hamburger-меню

## Скриншоты

Текущий интерфейс приложения, октябрь 2026 года. Скриншоты сделаны
в браузере из production-сборки на синтетических демонстрационных данных;
показатели иллюстрируют работу интерфейса, а не результаты исследования товара.

### Обзор товара

Новые проблемы, жалобы в положительных отзывах и покрытие выбранного запуска.

![Обзор товара: карточки проблем и объём обработанных отзывов](img/dashboard.png)

### Аналитика

Показатели сохранённого запуска, доли жалоб и тональность по аспектам.

![Аналитика запуска: покрытие, оценки, доли жалоб и аспекты](img/analytics.png)

### Скрытые проблемы

Группы повторяющихся жалоб, поддержка, цитаты и решения по карточкам.

![Список групп и карточка проблемы с цитатами и состоянием проверки](img/issues.png)

### Жалоба в положительном отзыве

Высокая оценка не исключает проблему: исходная цитата выделена в тексте,
а из отзыва можно перейти к группе жалоб.

![Детали отзыва с оценкой 5: выделенная жалоба и ссылка на группу](img/review-positive.png)

### Отзыв с отрицательной оценкой

Исходный текст, аспекты и описанные автором последствия проблемы.

![Детали отрицательного отзыва: цитата о протечке и последствия](img/review-negative.png)

### Отчёты

Выбор разделов PDF или DOCX и история формирования отчётов по снимку запуска.

![Формирование отчёта и история готовых файлов](img/reports.png)

## Стек

| Слой | Технологии |
|---|---|
| Frontend | React 18, TypeScript, Vite, **Recharts**, TanStack Query, Zustand, react-router-dom 6, react-dropzone, react-hot-toast, lucide-react |
| Backend | Node.js 24, Express 5, TypeScript, **Zod**, multer, helmet, cors, express-rate-limit, morgan, pino |
| Realtime | Socket.IO |
| Database | PostgreSQL 16 + **Prisma** ORM |
| Cache | Redis 7 (ioredis) |
| Auth | JWT access + refresh с ротацией в БД (bcryptjs) |
| ML / NLP | Локальный HTTP runtime, явно выбранный OpenRouter; `@xenova/transformers` (ONNX), версионированная группировка |
| Reports | pdfkit, docx |
| Парсинг | нативный fetch к feedbacks API Wildberries |
| Infra | Docker, docker-compose |

## Структура

```
hidden-issues-analyzer/
├── apps/
│   ├── api/                    # Express + Prisma + Socket.IO
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   │       ├── config/         # zod env
│   │       ├── lib/            # prisma, redis, logger, openrouter, embeddings
│   │       ├── middleware/     # auth, validate, error
│   │       ├── routes/         # auth, reviews, analysis, issues, reports, parsing, products, profile
│   │       ├── controllers/
│   │       ├── services/       # analyzer, clustering, summary, products, reports, parsing, stats, reviews, auth
│   │       ├── schemas/        # zod
│   │       ├── sockets/
│   │       └── index.ts
│   └── web/                    # React + Vite
│       └── src/
│           ├── components/     # Layout, Sidebar, ProductSelector, AiSummaryModal, AnalysisBanner, ProtectedRoute
│           ├── pages/          # Dashboard, Upload, Analytics, Issues, Reviews, Reports, Parsing, Products, Profile + Login/Register
│           ├── lib/            # api (axios), socket, queries (react-query)
│           └── store/          # auth.store, product.store (zustand)
├── docker-compose.yml          # postgres + redis
├── package.json                # workspaces root
└── .env.example
```

## Рабочая установка Windows

Нужен Docker Desktop с Linux containers. Node.js 24 нужен для сборки вне Docker
и вспомогательных команд обслуживания. Для готового образа npm на сервере не нужен.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action Init
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action Build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action Start
```

Откройте [локальное приложение](http://localhost:8080). API, страницы и Socket.IO
работают через один адрес; БД/Redis не публикуются. `Init` создаёт независимые
секреты и сохраняет существующий env. Миграции применяются через `migrate deploy`;
readiness ждёт БД, очередь и worker. Выберите способ анализа в «Профиль» →
«Модель анализа»: OpenRouter с вашим ключом или локальную модель из папки.
CPU-runtime llama.cpp запускается в отдельном контейнере автоматически;
второй компьютер, GPU и ручная установка runtime не требуются.

`Start` автоматически подготавливает вспомогательную модель эмбеддингов:
использует готовую `.cache/portable-models` или скачивает закреплённые файлы
(около 135 МБ) при первом запуске. Повторный запуск проверяет кэш без сети;
во время анализа скачивания запрещены. Для первой установки без интернета
используйте [автономный комплект](docs/deployment.md#комплект-переноса-без-скачивания-npm-пакетов).
Качество выбранной модели проверяется отдельно по [протоколу](docs/model-evaluation.md).
Прежний [план второго ПК](docs/second-pc.md) сохранён как необязательный вариант.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action Status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action Logs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/app.ps1 -Action Stop
```

Обновление: сделайте backup, получите новую версию, повторите Build и Start.
Сохраняйте Compose project и секреты; `down --volumes` удаляет данные.
Для офлайн-комплекта загрузите новые образы вместо Build. LAN, Firewall и
необязательный автозапуск описаны в [docs/deployment.md](docs/deployment.md).

## Выбор модели анализа

Откройте **«Профиль» → «Модель анализа»**. Настройки относятся к вашему аккаунту,
сохраняются на сервере и используются и для анализа, и для AI-сводки.
Уже созданный запуск сохраняет свой режим и модель. Автоматического перехода
с локальной модели в облако нет.

### OpenRouter

Выберите **OpenRouter** и модель из списка в профиле: доступны поиск и фильтр
бесплатных/платных вариантов. Рядом показаны цены за миллион входных и выходных
токенов из [каталога](https://openrouter.ai/models). Затем
вставьте [свой API-ключ](https://openrouter.ai/settings/keys), нажмите
**«Сохранить режим анализа»**, затем **«Проверить доступность»**.
Нужна текстовая instruct/chat-модель с поддержкой JSON. Отзывы и запросы к сводке
отправляются в OpenRouter; нужны интернет, доступ к выбранной модели и при
необходимости баланс. Проверка доступности не запускает платную генерацию.

В профиле и перед анализом показан остаток бесплатных запросов, полученный
по вашему сохранённому ключу, и время последней проверки. Это общий суточный
счётчик аккаунта для бесплатных моделей; смена модели или ключа его не обнуляет.
Время следующего дня вычисляется по правилу 00:00 UTC, а не выдаётся за
полученную от API точную метку сброса. Остаток поминутного лимита API не сообщает.
Если OpenRouter не вернул счётчик или обновление не удалось, интерфейс сообщает
об отсутствии актуального остатка. Лимит расходов ключа в долларах показан
отдельно от количества запросов и не является балансом аккаунта.
Один отзыв может потребовать несколько запросов; сводки и повторы тоже
расходуют лимит. Подробнее: [лимиты OpenRouter](https://openrouter.ai/docs/api_reference/limits).

Ключ хранится в БД с AES-256-GCM, привязан к аккаунту и не возвращается клиенту;
не помещайте его в исходники. Для расшифровки сохраняйте прежний
`JWT_REFRESH_SECRET` при обновлении и восстановлении либо введите ключ заново.

Начальный бесплатный вариант — `openrouter/free`:
[маршрутизатор бесплатных моделей](https://openrouter.ai/openrouter/free).
Он выбирает доступную бесплатную модель, поэтому конкретная модель может
меняться между запросами. Для сравнения качества укажите ID конкретной модели.
Для этого маршрутизатора приложение передаёт JSON-схему результата и отключает
дополнительное рассуждение, чтобы сохранить бюджет токенов для полного ответа.
Бесплатные варианты с суффиксом `:free` могут исчезать из каталога; платный ID
без этого суффикса — другой выбор и автоматически не подставляется. Если
проверка сообщает, что модель не найдена, обновите ID в профиле и сохраните.

### Локально: скачать один файл и положить в папку

Это основной сценарий **production Docker-установки**. Видеокарта и отдельный
LLM-сервер не нужны: закреплённый образ llama.cpp работает на CPU. Один runtime
и один GGUF-файл общие для этой установки; выбор облака/локального режима и
облачный ключ — у каждого аккаунта свои.

1. Скачайте **один** файл по ссылке ниже. Это ссылки на скачивание, весь
   репозиторий модели загружать не нужно. Завершите скачивание вне папки модели.
2. Переименуйте готовый файл в **`model.gguf`** и положите в
   **`models/llm/model.gguf`** относительно корня проекта. Например:
   `D:\IA\hidden-issues-analyzer\models\llm\model.gguf`.
3. Запустите приложение обычным `scripts/app.ps1 -Action Start`, если оно ещё
   не запущено. Уже работающий контейнер автоматически замечает появление файла.
4. В профиле выберите **«Локально · CPU»**, сохраните режим, дождитесь загрузки
   модели и нажмите **«Проверить доступность»**. Отсутствующий или неверный файл
   отображается отдельно; остальные страницы работают без модели.

| Модель, Q4_K_M | Скачать один GGUF | Размер файла | Для чего пробовать |
| --- | --- | ---: | --- |
| Qwen2.5 1.5B Instruct | [qwen2.5-1.5b-instruct-q4_k_m.gguf](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true) | 1,12 ГБ | Самая лёгкая из списка; первый запуск на CPU, проверка всей цепочки |
| Qwen2.5 3B Instruct | [qwen2.5-3b-instruct-q4_k_m.gguf](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf?download=true) | 2,10 ГБ | Следующий вариант для сравнения качества и времени на ПК с 16 ГБ RAM |
| Qwen3 4B Instruct 2507 | [Qwen3-4B-Instruct-2507-Q4_K_M.gguf](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf?download=true) | 2,50 ГБ | Более тяжёлый кандидат для ПК с 16 ГБ RAM и запасом свободной памяти |

Первые два GGUF опубликованы командой Qwen; третий — квантование Unsloth
[исходной модели Qwen](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507).
Ссылки и размеры сверены 4 ноября 2026. Это кандидаты для проверки, а не
подтверждённые результаты качества на отзывах. Размер файла не равен расходу
RAM: память также нужна для контекста, Windows, Docker и самого приложения.
Для ноутбука с 16 ГБ RAM начните с 1.5B или 3B и закройте лишние приложения.
Для иного оборудования ориентируйтесь на доступную память и замеры; никаких
требований к объёму VRAM у CPU-режима нет.

Начальные настройки: контекст 4096, один запрос одновременно, четыре CPU-потока,
таймаут запроса до 5 минут. Крупные партии могут обрабатываться часами;
время и качество измерьте на 30–50 разных отзывах. Модели других архитектур,
thinking-модели, GGUF-шарды и файлы `mmproj` не считаются взаимозаменяемыми.

**Замена модели:** завершите анализ, выполните `scripts/app.ps1 -Action Stop`,
замените `model.gguf`, затем выполните `scripts/app.ps1 -Action Start`.
SHA-256 файла сохраняется в настройках запуска: другая модель не подставляется
незаметно в старое задание. Для анализа другой моделью создайте новый запуск.
Файлы GGUF исключены из Git, Docker build context и резервной копии БД;
модель переносится отдельно. Runtime уже входит в новый offline-комплект,
поэтому после подготовки образов, GGUF и эмбеддингов локальный режим не
требует скачиваний. OpenRouter всегда требует соединения.

При обновлении старой установки сохраните секреты и добавьте в `deploy/.env`:

```dotenv
LOCAL_LLM_BASE_URL=http://local-llm:8081/v1
LOCAL_LLM_MODEL_FILE=/app/local_models/model.gguf
```

Затем пересоберите и запустите приложение: новая миграция создаёт таблицу
настроек аккаунтов. Выберите нужный режим в профиле. Вариант разработки с
`npm run dev` по-прежнему поддерживает внешний HTTP-runtime из `LLM_BASE_URL`;
для автоматического CPU-runtime используйте production Docker.

## Разработка локально

```powershell
# 1. Node.js 24 (точная проверенная версия в .nvmrc), npm 10 или 11
# Docker Desktop должен быть запущен
npm ci

# 2. Поднять Postgres + Redis
npm run docker:up

# 3. Создать .env-файлы
foreach ($file in @('.env', 'apps/api/.env', 'apps/web/.env')) {
  if (-not (Test-Path -LiteralPath $file)) { Copy-Item -LiteralPath "$file.example" -Destination $file }
}
# Заменить JWT-секреты примера; для dev на этом ПК использовать API_HOST=127.0.0.1.
# По умолчанию local: настроить LLM_BASE_URL и LLM_MODEL для отдельно установленного runtime.
# Для облака выбрать LLM_PROVIDER=openrouter, облачные URL/model и OPENROUTER_API_KEY.

# 4. Сгенерировать клиент и применить сохранённые миграции БД
npm run db:generate
npm run db:deploy
npm run db:check

# 5. Запустить dev (api + web + worker параллельно)
npm run dev
```

- API:  http://localhost:4000
- Web:  http://localhost:5173

## Команды

```bash
npm run dev            # api + web + worker в dev-режиме
npm run build          # production build
npm run lint           # ESLint
npm run test           # Vitest
npm run typecheck      # TypeScript в обоих workspace, включая конфиги web
npm run check          # typecheck + lint + test + production build
npm run docker:up      # postgres + redis
npm run docker:down    # остановить
npm run db:migrate     # создать новую миграцию при изменении schema.prisma
npm run db:deploy      # применить существующие миграции, включая чистую БД
npm run db:generate    # prisma generate
npm run db:check       # соединение с PostgreSQL, таблица Product и Redis PING
npm run start:api      # API из production build
npm run start:worker   # отдельный worker из production build
npm run preview:web    # локальный просмотр собранного web
npm run tasks:summary  # обновить сводку выполнения всех фаз в TASKS.md
npm run test:production:web        # assets и прямое открытие вложенных маршрутов
npm run test:production:hosting    # раздача SPA самим API
npm run test:production:compose    # Docker, readiness, сохранность данных, Socket.IO, backup/restore
npm run test:integration:access    # два аккаунта, сессии, HTTP и Socket.IO
npm run test:integration:llm       # выбор модели, ключи аккаунтов и отдельный worker
npm run test:integration:migration # старая схема, backup/restore и новые миграции
npm run storage:inspect           # план очистки; -- --apply применяет его
```

`npm run check` включает также SQL-проверки миграций. Для production compose
сначала соберите образ `reviewlens-app:local`. Браузерная проверка включается
через `PLAYWRIGHT_MODULE`/`BROWSER_EXECUTABLE`; детали — в deployment.md.

## Импорт, анализ и отчёт

Создайте аккаунт и товар, откройте «Загрузка», выберите CSV или ручной ввод.
CSV поддерживает UTF-8/BOM и сопоставление колонок; предпросмотр показывает ошибки
до сохранения. Для первого показа используйте [4 демо-товара и CSV](docs/demo/README.md).
Внешний ID сохраняет первоначальный импорт и защищает повторную загрузку от дублей.
Отсутствующие даты и оценки остаются неизвестными.

Запускайте анализ выбранного товара. Обновление страницы восстанавливает runId;
новые отзывы не меняют сохранённую область. Ошибки/отмена видны отдельно от успеха.
В «Проблемы» проверьте исходные цитаты и контекст оценок 4–5, затем сформируйте
PDF/DOCX для того же запуска и периода. CSV выгружает всю отфильтрованную область.
Подробный [сценарий показа](docs/demo-walkthrough.md) занимает путь от импорта до отчёта.

## Backup и восстановление

```powershell
node scripts/production-storage.mjs backup --directory D:\ReviewLens-backups\before-update
node scripts/production-storage.mjs restore --directory D:\ReviewLens-backups\before-update --env-file deploy/.env --project reviewlens-restored
```

Backup ненадолго останавливает API/worker и сохраняет БД с отчётами/контрольными
суммами. Restore допускает только пустую БД и пустой каталог отчётов; не удаляйте
исходную установку. Для проверки восстановления рядом выберите другой порт в
отдельном env. Секреты и модели сохраняйте отдельно. Подробности и dev-команды:
[operations.md](docs/operations.md), [deployment.md](docs/deployment.md).

## Частые ошибки

| Симптом | Действие |
| --- | --- |
| Start не готов / `/ready` отвечает 503 | Посмотрите Status/Logs; проверьте миграцию, PostgreSQL/Redis и heartbeat worker |
| «Модель недоступна» | Проверьте модельный ID, runtime и URL из контейнера; облако автоматически не включается |
| Нет файлов эмбеддингов | Перенесите полный каталог/manifest, сверяйте model+revision и выполните offline-проверку |
| 403 при входе / CORS | `WEB_ORIGIN` должен точно совпадать с адресом браузера, включая localhost/IP и порт |
| Миграция требует владельца/происхождения | Сначала backup и явное подтверждённое назначение; [переход данных](docs/data-migration.md) |
| Wildberries недоступен | Используйте CSV; неофициальный источник не гарантирует доступность и полноту истории |
| Нет npm / неподдерживаемая версия | Для разработки установите Node 24 и npm 10/11; готовый production-образ npm не требует |

Свежие [программные проверки](docs/local-validation.md), [оценка качества модели](docs/model-evaluation.md)
и [оставшиеся действия второго ПК](docs/second-pc.md) описаны отдельно.

Подробности воспроизводимости, ограничения worker и результаты проверки:
[docs/development.md](docs/development.md).

Режимы LLM, проверка доступности, таймауты и ограничения:
[docs/llm-provider.md](docs/llm-provider.md). При отсутствии модели импорт
остаётся доступен; реальная локальная модель ещё не проверялась на втором ПК.

Переходная модель данных, правила назначения владельцев старых записей и
проверка миграции на отдельной БД: [docs/data-migration.md](docs/data-migration.md).

## Ключевые API эндпоинты

```
POST   /api/auth/register        регистрация
POST   /api/auth/login           вход
POST   /api/auth/refresh         обновление токена
GET    /api/auth/me              текущий пользователь

POST   /api/reviews/upload/csv   multipart файл
POST   /api/reviews/upload/text  ручной отзыв
GET    /api/reviews              пагинация + фильтры
GET    /api/reviews/export/csv  вся область с фильтрами списка, без пагинации
GET    /api/reviews/:id

POST   /api/analysis/run         { productId, mode?, selection?, period?, limit? } → 202, runId
GET    /api/analysis/stats       сводка
GET    /api/analysis/timeseries  динамика по дням
GET    /api/analysis/summary     AI executive summary (LLM, ?productId)

GET    /api/analysis/runs        история запусков владельца
GET    /api/analysis/runs/:id    сохранённое состояние
GET    /api/analysis/runs/:id/inputs  исходные снимки и результаты
GET    /api/issues/groupings     группы выбранного товара/запуска
GET    /api/issues/snapshots/:id/evidence  проверяемые цитаты
PATCH  /api/issues/problems/:id/state   состояние устойчивой карточки
POST   /api/issues/groupings/:id/edit   preview/commit merge, split, restore
POST   /api/issues/recompute     пересчитать группировку указанного runId

GET    /api/products             список продуктов
PATCH  /api/products/:id         переименовать продукт
DELETE /api/products/:id         удалить продукт

POST   /api/parsing/start        { url } — ссылка или артикул WB → 202, jobId
GET    /api/parsing/status/:jobId  сохранённый статус и счётчики импорта
POST   /api/parsing/status/:jobId/cancel  отмена импорта владельцем

POST   /api/reports/generate     { productId, runId, period, format, sections, days?, title? }
GET    /api/reports
GET    /api/reports/:id/download

GET    /api/profile/stats
```

## WebSocket события (Socket.IO)

```
client → server: 'job:subscribe' (jobId)
server → client: 'analysis:state'  сохранённое авторизованное состояние запуска
server → client: 'analysis:progress' { jobId, processed, total }
server → client: 'analysis:complete' { jobId }
server → client: 'analysis:error'    { jobId, message }
```

Устойчивая очередь, история запусков, отмена и проверка worker:
[docs/analysis-worker.md](docs/analysis-worker.md). Запуск требует выбранного товара.

Структурированные жалобы, цитаты, нормализация аспектов и результаты запуска:
[docs/extraction-evidence.md](docs/extraction-evidence.md).
В истории запусков можно открыть исходные отзывы с выделенными цитатами.
`npm run test:sql` проверяет миграции и триггер повторов без Docker;
проверки очереди с PostgreSQL/Redis выполняются отдельно.

Группировка запусков, атомарные публикации, показатели и ограничения:
[docs/grouping.md](docs/grouping.md). `npm run benchmark:grouping` измеряет
алгоритм на синтетических векторах без загрузки модели. Обзор, аналитика и новые отчёты используют выбранный сохранённый запуск.
Календарные расчёты, полный CSV и снимок отчёта описаны в
[docs/analytics-and-reports.md](docs/analytics-and-reports.md). Рабочие страницы,
знаменатели показателей и проверки: [docs/working-pages.md](docs/working-pages.md).

Сводка всех фаз: [TASKS.md](TASKS.md). Закрытие прежних задач,
идемпотентный потоковый CSV, очереди Wildberries, длинные отзывы и кэш:
[аудит 20 октября](docs/backlog-audit.md). Health/readiness, сроки хранения,
backup/restore и лимиты: [обслуживание](docs/operations.md).
Для кэша извлечения задайте `LLM_MODEL_VERSION` как неизменяемую ревизию модели;
значение `unverified` отключает переиспользование ответов.
