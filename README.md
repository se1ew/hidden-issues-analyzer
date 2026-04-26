# Hidden Issues Analyzer

Интеллектуальная система анализа отзывов о товарах с **выявлением скрытых проблем**.
Курсовая работа.

## Стек

| Слой | Технологии |
|---|---|
| Frontend | React 18, TypeScript, Vite, **Recharts**, socket.io-client |
| Backend | Node.js 20, Express 5, TypeScript, **Zod** |
| Realtime | Socket.IO |
| Database | PostgreSQL 16 + **Prisma** ORM |
| Cache / Queue | Redis 7 (ioredis) + BullMQ |
| Auth | JWT access + refresh с ротацией в БД |
| ML / NLP | **OpenRouter** (NVIDIA Nemotron) + `@xenova/transformers` + density-clustering |
| Reports | pdfkit, docx |
| Парсинг | playwright / cheerio |
| Infra | Docker, docker-compose |
| Quality | ESLint, Prettier, Vitest, Jest |
| Security | Helmet, express-rate-limit, bcrypt |
| Logs | Morgan + Pino |

## Страницы (7)

1. **Загрузка** — CSV / ручной ввод / парсинг URL
2. **Аналитика** — метрики, графики, динамика негатива
3. **Скрытые проблемы** — кластеры жалоб, оценка скрытости (ключевая страница)
4. **Отзывы** — таблица с фильтрами и модалкой деталей
5. **Отчёты** — генерация PDF / Word
6. **Парсинг** — режим парсинга маркетплейсов
7. **Профиль** — статистика пользователя

## Структура

```
hidden-issues-analyzer/
├── apps/
│   ├── api/        # Express + Prisma + Socket.IO
│   └── web/        # React + Vite
├── docker-compose.yml
├── package.json    # workspaces root
└── .env.example
```

## Запуск

```bash
# 1. Установить зависимости
npm install

# 2. Поднять Postgres + Redis
npm run docker:up

# 3. Скопировать env
copy .env.example .env
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.example apps\web\.env
# отредактировать apps/api/.env — вписать OPENROUTER_API_KEY

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
npm run test           # Vitest/Jest
npm run format         # Prettier
npm run docker:up      # postgres + redis
npm run docker:down    # остановить
npm run db:migrate     # prisma migrate dev
npm run db:generate    # prisma generate
```
