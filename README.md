# Hidden Issues Analyzer

Интеллектуальная система анализа отзывов о товарах с **выявлением скрытых проблем**.
Курсовая работа.

## Что умеет

- Загрузка отзывов: CSV / ручной ввод / парсинг Wildberries
- Анализ через LLM (OpenRouter): тональность, аспекты, выделение проблем
- Кластеризация жалоб через эмбеддинги (`@xenova/transformers`) + DBSCAN
- Метрика **hidden_score = severity × (1 − visibility)** — ранжирует «скрытые» проблемы
- 7 страниц UI: Загрузка, Аналитика, Скрытые проблемы, Отзывы, Отчёты, Парсинг, Профиль
- Real-time прогресс анализа через Socket.IO
- Экспорт PDF / DOCX отчётов

## Стек

| Слой | Технологии |
|---|---|
| Frontend | React 18, TypeScript, Vite, **Recharts**, TanStack Query, Zustand, react-router-dom 6, react-dropzone, react-hot-toast, lucide-react |
| Backend | Node.js 20+, Express 5, TypeScript, **Zod**, multer, helmet, cors, express-rate-limit, morgan, pino |
| Realtime | Socket.IO |
| Database | PostgreSQL 16 + **Prisma** ORM |
| Cache | Redis 7 (ioredis) |
| Auth | JWT access + refresh с ротацией в БД (bcryptjs) |
| ML / NLP | **OpenRouter** (NVIDIA Nemotron) + `@xenova/transformers` (ONNX) + `density-clustering` (DBSCAN) |
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
│   │       ├── routes/         # auth, reviews, analysis, issues, reports, parsing, profile
│   │       ├── controllers/
│   │       ├── services/       # бизнес-логика
│   │       ├── schemas/        # zod
│   │       ├── sockets/
│   │       └── index.ts
│   └── web/                    # React + Vite
│       └── src/
│           ├── components/     # Layout, Sidebar, ProtectedRoute
│           ├── pages/          # 7 основных + Login/Register
│           ├── lib/            # api (axios), socket, queries (react-query)
│           └── store/          # auth.store (zustand)
├── docker-compose.yml          # postgres + redis
├── package.json                # workspaces root
└── .env.example
```

## Запуск (с нуля)

```powershell
# 1. Установить зависимости
npm install

# 2. Поднять Postgres + Redis
npm run docker:up

# 3. Создать .env-файлы
copy .env.example .env
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.example apps\web\.env
# ВАЖНО: в apps/api/.env вписать OPENROUTER_API_KEY

# 4. Применить миграции БД
npm run db:migrate

# 5. Запустить dev (api + web параллельно)
npm run dev
```

- API:  http://localhost:4000
- Web:  http://localhost:5173

## Команды

```bash
npm run dev            # api + web в dev-режиме
npm run build          # production build
npm run lint           # ESLint
npm run test           # Vitest
npm run docker:up      # postgres + redis
npm run docker:down    # остановить
npm run db:migrate     # prisma migrate dev
npm run db:generate    # prisma generate
```

## Workflow использования

1. **Регистрация** на `/register`
2. **Загрузка** CSV (колонки: `text/review/comment`, опционально `rating/score`, `date`)
3. На странице **Отзывы** нажать «Запустить анализ» — LLM проанализирует пачку
4. На **Аналитика** появятся метрики и графики
5. На **Скрытые проблемы** нажать «Пересчитать» — DBSCAN-кластеризация
6. На **Отчёты** сгенерировать PDF или DOCX

## Ключевые API эндпоинты

```
POST   /api/auth/register        регистрация
POST   /api/auth/login           вход
POST   /api/auth/refresh         обновление токена
GET    /api/auth/me              текущий пользователь

POST   /api/reviews/upload/csv   multipart файл
POST   /api/reviews/upload/text  ручной отзыв
GET    /api/reviews              пагинация + фильтры
GET    /api/reviews/:id

POST   /api/analysis/run         { limit? } — анализ pending отзывов (jobId)
GET    /api/analysis/stats       сводка
GET    /api/analysis/timeseries  динамика по дням

GET    /api/issues               список скрытых проблем
POST   /api/issues/recompute     пересчитать кластеры
GET    /api/issues/:id

POST   /api/parsing/start        { url } — парсинг WB

POST   /api/reports/generate     { format: 'pdf'|'docx', title? }
GET    /api/reports
GET    /api/reports/:id/download

GET    /api/profile/stats
```

## WebSocket события (Socket.IO)

```
client → server: 'job:subscribe' (jobId)
server → client: 'analysis:progress' { jobId, processed, total }
server → client: 'analysis:complete' { jobId }
server → client: 'analysis:error'    { jobId, message }
```
