# План API первой версии

11 октября 2026. Целевой контракт по [спецификации](product-spec.md),
[запускам](analysis-run-lifecycle.md) и [карточкам](problem-lifecycle.md).
Это план реализации; текущие маршруты ещё имеют другой формат и поведение.
Переключение frontend и backend выполняется совместно, с сохранением истории
данных. Базовый путь `/api`, JSON UTF-8, время ISO 8601 UTC, ID — непрозрачные
строки. Клиент не извлекает время или владельца из ID.

## Общие правила

Все операции с данными требуют access token `Authorization: Bearer ...`.
Владелец определяется из токена, `userId` из запроса не принимается.
Несуществующий и чужой ID возвращают одинаковый `404 NOT_FOUND`, включая
вложенные ID импортов/отзывов/запусков/снимков. Отсутствующая или истёкшая
сессия — `401 UNAUTHENTICATED`. Cookie-запросы проверяют разрешённый Origin
и обязательный CSRF-заголовок; CORS разрешает только настроенный origin.

Успешный ответ: `{ "data": ... }`, кроме бинарного скачивания и `204` без тела.
Список: `{ "data": { "items": [], "total": 0, "page": 1, "pageSize": 20 } }`.
`page` — целое >=1, `pageSize` — 1..100, по умолчанию 20. Страница за пределами
списка возвращает пустые `items` при сохранении `total`. Сортировка стабильна,
с дополнительным ID при равных значениях. Неизвестные поля и фильтры дают `422`.
Поиск `search` — подстрока без учёта регистра, максимум 200 символов.
Списки возвращают только данные владельца. `null` означает отсутствие значения.

Формат ошибки:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Некорректный запрос",
    "details": [{ "path": "period.to", "message": "Должно быть позже period.from" }],
    "requestId": "opaque-request-id"
  }
}
```

| HTTP | Коды и назначение |
| --- | --- |
| 400 | `MALFORMED_REQUEST`: повреждённый JSON или multipart |
| 401 | `UNAUTHENTICATED`: нужна действующая сессия |
| 403 | `CSRF_REJECTED`: запрещённый cookie-запрос |
| 404 | `NOT_FOUND`: ресурс недоступен |
| 409 | `ACTIVE_RUN`, `VERSION_CONFLICT`, `INVALID_TRANSITION`, `RESULT_INVALIDATED`, `DEPENDENT_REPORTS` |
| 413 | `UPLOAD_TOO_LARGE`: превышен документированный лимит файла |
| 415 | `UNSUPPORTED_MEDIA_TYPE`: неподдерживаемый тип файла |
| 422 | `VALIDATION_ERROR`: поля, фильтры или содержимое импорта |
| 429 | `RATE_LIMITED`: повтор после `Retry-After` |
| 503 | `SERVICE_UNAVAILABLE`: БД/очередь недоступны, задача не принята |
| 500 | `INTERNAL_ERROR`: непредвиденная ошибка без внутренних деталей |

Ошибки принятой фоновой задачи хранятся в её состоянии; ранее выданный `202`
не превращается задним числом в HTTP-ошибку. Ответы не содержат SQL, секретов,
внутренних путей или сырых ответов провайдера модели.

## Авторизация

| Метод и путь | Запрос / результат |
| --- | --- |
| `POST /auth/register` | `{email,password,name?}` → 201, `{user,accessToken}` и refresh cookie |
| `POST /auth/login` | `{email,password}` → 200, тот же формат сессии |
| `POST /auth/refresh` | Refresh из HttpOnly cookie, CSRF-заголовок → 200, новый access token и ротация cookie |
| `POST /auth/logout` | Отзыв текущей сессии и очистка cookie → 204 |
| `GET /auth/me` | `{id,email,name}` текущего пользователя |

Access token хранится в памяти клиента. Refresh cookie: HttpOnly, SameSite=Lax,
Secure в HTTPS-развёртывании; локальный HTTP допускается конфигурацией разработки.
Для всех четырёх POST операций сессии обязателен `X-ReviewLens-CSRF: 1`;
Origin, когда присутствует, должен точно совпадать с WEB_ORIGIN, а
Sec-Fetch-Site: cross-site отклоняется. Заголовок требует CORS preflight в браузере;
сервер разрешает его только настроенному origin. Это защита через обязательный
нестандартный заголовок и проверку origin, отдельная CSRF-cookie не используется.
Клиенты без Origin также обязаны передавать заголовок. При перезагрузке страницы
клиент делает refresh с credentials, используя HttpOnly cookie автоматически.
API и frontend должны быть same-site: локально на localhost, при HTTPS —
на одном сайте. Развёртывание на разных сайтах требует другого cookie-контракта.
Logout идемпотентен при уже отозванной сессии; кэш frontend очищается.

## Товары, импорты и отзывы

| Метод и путь | Запрос / результат |
| --- | --- |
| `POST /products` | `{name,source?,externalId?,sourceUrl?}` → 201, товар |
| `GET /products` | Пагинация, `search`; сортировка createdAt DESC, ID |
| `GET /products/:productId` | Товар и сводные счётчики |
| `PATCH /products/:productId` | `{name}` → обновлённый товар |
| `DELETE /products/:productId` | 204; активный запуск → 409 `ACTIVE_RUN` |
| `POST /products/:productId/imports/csv` | Multipart `file` → 201, итог импорта и ID |
| `POST /products/:productId/imports/text` | `{text,rating?,reviewDate?}` → 201, импорт и отзыв |
| `POST /products/:productId/imports/parsing` | `{url}` → 202, импорт со статусом `queued` |
| `GET /products/:productId/imports` | Пагинация, `source`, `status` |
| `GET /imports/:importId` | Источник, статус, added/skipped/failed и диагностика строк |
| `GET /products/:productId/reviews` | Пагинация и фильтры ниже |
| `GET /reviews/:reviewId` | Исходный отзыв и ссылка на выбранный результат `?runId` |
| `DELETE /reviews/:reviewId` | 204; запрет для активного запуска, инвалидация зависимых результатов |

Импорт никогда не выбирает товар только по имени: используется ID владельца.
Сохранение товара не выдаёт его секреты или внутренние поля. Повтор внешнего ID
в пределах товара сохраняет первоначальную дату импорта и происхождение.
Для CSV ошибки отдельных строк доступны в результате; ни одной валидной строки
→ 422. Предел размера файла пока соответствует текущим 25 MiB и подлежит
проверке при реализации импорта. Превышение не создаёт импорт.

Фильтры отзывов: `importId`, `runId`, `rating` (1..5), `sentiment`
(`positive|neutral|negative`), `analysisStatus` (`pending|succeeded|failed`),
`search`, `from`, `to`, `includeUndated` (допустим только без периода).
Фильтры результата `sentiment`/`analysisStatus` требуют `runId`.
Период по исходной дате, `[from,to)`, UTC; отзывы без даты исключаются
с отдельным `excludedUndated` в выдаче. Отсутствующий рейтинг не равен нулю.
Сортировка отзывов — importedAt DESC, ID. Исходные отзывы не переписываются
полями повторного анализа.

## Запуски

`POST /analysis/runs` принимает:

```json
{
  "productId": "product-id",
  "selection": { "kind": "imports", "importIds": ["import-id"] },
  "period": { "from": "2026-01-01T00:00:00Z", "to": "2026-02-01T00:00:00Z" },
  "mode": "new_only"
}
```

`selection`: `{kind:"all_reviews"}` либо `{kind:"imports",importIds:[...]}`,
непустой уникальный список ID того же товара. `period` необязателен; если
присутствует, обе границы обязательны и `from < to`. Режимы `new_only|reanalyze`.
Настройки модели выбираются из серверной конфигурации; произвольные URL,
ключи и имена моделей от клиента не принимаются в первой версии.

Ответ `202`: `{data:{runId,status:"queued",total,scope,configurationVersion}}`.
Запуск и снимок состава уже сохранены. Повторный HTTP-запрос после потери ответа
не должен создавать второй запуск: обязательный `Idempotency-Key` связывается
с владельцем, операцией и нормализованным запросом. Тот же ключ и тело возвращают
тот же `runId`; другое тело с тем же ключом → 409 `VERSION_CONFLICT`.
Срок хранения ключей задаётся конфигурацией и публикуется в документации среды.

| Метод и путь | Результат |
| --- | --- |
| `GET /analysis/runs` | Пагинация, `productId`, `status`; createdAt DESC, ID |
| `GET /analysis/runs/:runId` | Область, конфигурация, статус, этап, версия, счётчики, время и ошибки |
| `POST /analysis/runs/:runId/cancel` | 202 при принятой отмене; 200 с текущим статусом при уже терминальном запуске |
| `DELETE /analysis/runs/:runId` | 204 только для терминального запуска без отчётов; иначе 409 |
| `GET /analysis/runs/:runId/reviews` | Пагинация результатов, `status`, `search` |
| `GET /analysis/runs/:runId/stats` | Метрики только этого снимка, ошибки/remaining и знаменатели |
| `GET /analysis/runs/:runId/timeseries` | `bucket=day|week|month`, период по исходной дате; число недатированных отдельно |
| `POST /analysis/runs/:runId/summary` | AI-вывод по сохранённым результатам → 200, `{text,runId,configurationVersion}` |

Состояние содержит `total,succeeded,failed,processed,remaining`,
`cancelRequestedAt,startedAt,finishedAt`, `version` и пригодность этапов.
Потребители результатов получают явный признак неполноты `partial` и проверяют
готовность нужного этапа. Отчёты по `cancelled`/`interrupted` в первой версии
не генерируются; результаты отзывов остаются доступны для диагностики.
Инвалидированный запуск не выдаёт метрики как актуальные: 409 `RESULT_INVALIDATED`.

Результат отзыва: `reviewId,runId,status,sentiment,aspects,issues,error`.
Упоминание жалобы содержит ID, аспект, область, описание, `quote,start,end`;
позиции UTF-16 проверяются в исходном тексте. Ошибка не маскируется пустой
успешной жалобой. Один отзыв может иметь несколько разных проблем.

## Проблемы и отчёты

| Метод и путь | Запрос / результат |
| --- | --- |
| `GET /products/:productId/problems` | Пагинация, `runId`, `state`, `hidden`, `search`; H DESC, C DESC, ID |
| `GET /problems/:problemId` | Устойчивая карточка; `?runId` выбирает снимок и цитаты |
| `GET /problems/:problemId/history` | Пагинация действий, время DESC, ID |
| `PATCH /problems/:problemId/state` | `{state,expectedVersion,reason?}` → карточка; конфликт версии → 409 |
| `POST /reports` | `{runId,format:"pdf"|"docx",title?}` → 202, `{reportId,status:"queued"}` |
| `GET /reports` | Пагинация, `productId`, `runId`, `status`; createdAt DESC, ID |
| `GET /reports/:reportId` | Метаданные, состояние генерации и безопасная ошибка |
| `GET /reports/:reportId/download` | Авторизованный поток PDF/DOCX, Content-Disposition attachment |
| `DELETE /reports/:reportId` | 204 после удаления артефакта; незавершённая генерация → 409 |

Списки проблем и карточка со снимком требуют `runId`, чтобы знаменатели и
цитаты не смешивались между запусками. Только история допускает запрос без него.
Список дополнительно возвращает число одиночных сигналов отдельно от карточек.
Метаданные отчёта: ID, товар, запуск, заголовок, формат, `queued|running|completed|failed`,
даты, неполнота результатов; без `filePath`. Генерация допустима по `completed`
или `partial` с успешным этапом группировки; неполнота заметна в документе.
Скачивание незавершённого отчёта → 409 `INVALID_TRANSITION`.
Состояние карточки требует явного целевого значения, вместо toggle-флага.

## Socket.IO

Handshake требует access token; при истечении клиент обновляет сессию и
переподключается. `run:subscribe {runId}` проверяет владельца и возвращает
полный актуальный снимок. Чужой/неизвестный запуск → `NOT_FOUND`, без подписки.
`run:changed {runId,version,status,stage,counters,cancelRequestedAt,finishedAt}`
содержит версию сохранённого состояния. Клиент игнорирует старые версии;
после разрыва запрашивает полный статус через HTTP. Завершение и ошибка —
значения статуса в том же событии, а не отдельное непроверяемое обещание.

## Переключение с текущего API

Сейчас ответы не имеют общей оболочки; запуск возвращает `jobId`, результаты
лежат в `Review`, а проблемы имеют один флаг `resolved`. План требует `runId`,
снимков и устойчивой карточки. Маршруты `/analysis/run`, `/issues/recompute`,
`/issues/:id/resolve`, глобальные загрузки и GET AI-summary заменяются
описанными операциями после реализации данных и очереди. До переключения
документ не используется как утверждение о возможностях текущего сервера.
