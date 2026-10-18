# Архитектура Компаса

## Текущий локальный MVP

Браузер/PWA → один origin http://127.0.0.1:4174 → Node 24 (статические файлы и /api) → PostgreSQL 17. Сервер и БД в Docker Compose, плюс одноразовый контейнер миграций; Vite/React собираются отдельным слоем Dockerfile. Для этого MVP использован существующий Node-сервер и общий JavaScript-подсчёт шкал, чтобы не дублировать клиническую логику на двух языках. FastAPI из первоначального плана не добавлялся параллельно вторым API.

- Frontend: React 19.2, Vite 6.4.4, Phosphor, CSS-токены. Семь непрерывных палитр, исходная v4-графика 971×1619. Вкладки остаются смонтированными, но страницы не двигаются.
- API: встроенный HTTP Node, node-postgres 8.23.1, параметризованные SQL-запросы, лимит JSON 100 KB, Origin/Host/CSRF, ограничение частоты. Нет приёма файлов, произвольного HTML, внешних LLM. Публичный исследовательский справочник имеет отдельную схему knowledge и read-only API, без доступа к пациентским таблицам.
- Хранилище: PostgreSQL, постоянный именованный том, отдельная runtime-роль compass_app без superuser/BYPASSRLS и без владения таблицами. RLS на записях и дневных отметках препаратов; контекст профиля задаётся только внутри транзакции и сбрасывается после неё.
- Шифрование: содержимое записей и ответы в AES-256-GCM envelope, случайный IV, AAD из ID профиля и записи. Ключ отдельно от PostgreSQL через Docker secret. Даты/типы записей, сессии и статусы демопрепаратов остаются метаданными в БД.
- Локальный профиль: непрозрачная случайная cookie HttpOnly/SameSite=Strict; в БД хранится хеш токена. Срок 30 дней, разные браузеры имеют отдельные профили. Полноценная идентификация и восстановление доступа отсутствуют.
- Время: Europe/Moscow для прототипа; observation_day отдельно от createdAt. Дата и результат проверяются сервером; присланный клинический балл не является источником истины.

## Данные и API

| Сущность | Хранение |
|---|---|
| local_patients | Технический ID локального профиля, без ФИО/контактов |
| app_sessions | Хеш cookie-токена, CSRF-токен, срок, связь с профилем |
| patient_entries | ID, тип, день наблюдения, зашифрованное содержимое, время сохранения |
| patient_doses | Профиль, день, один из двух демопрепаратов, статус; составной ключ исключает дубли |

patient_entries содержит journal (заголовок и длинный текст), mood (шкала/слова/факторы/время), sleep (длительность/качество), assessment (форма/версия/ответы/балл/уровень). Начальные примеры создаются один раз при создании профиля. После обновления страницы они не перезаписывают пользовательские записи.

| Запрос | Назначение |
|---|---|
| GET /api/session | Получить CSRF-токен действующего локального профиля |
| POST /api/session | Открыть отдельный локальный профиль; требуется правильный Origin и собственный заголовок клиента |
| GET /api/state | Получить собственные записи и сегодняшние статусы препаратов |
| PUT /api/entries/:id | Сохранить/редактировать запись; ID идемпотентен внутри профиля, дата и схема проверяются сервером |
| PUT /api/doses/:id | Поменять собственную сегодняшнюю отметку приёма |
| GET /api/health | Проверить готовность локального сервера и БД |

assessment после сохранения неизменяем; новое прохождение создаёт новый ID. PHQ-9 и GAD-7 проверяются общим модулем src/assessments.js на сервере и клиенте. API не принимает patient_id от клиента. При ошибке записи интерфейс не показывает успех и оставляет введённое в форме.

## Сеть и эксплуатация

db подключена только к внутренней сети private, без публикации 5432. web подключён к private и отдельной edge-сети для loopback-порта 4174. В Docker Desktop порт контейнера, подключённого только к internal-сети, не публиковался; edge добавлен для доступа с этого компьютера. Это не запрет исходящих соединений контейнера web.

Контейнер web непривилегирован, read_only, cap_drop ALL, no-new-privileges. Docker secrets здесь являются файловыми read-only mounts, не облачным KMS. На хосте родительская .local-secrets имеет режим 0700. Ключи исключены из Docker build context. Потеря ключа означает потерю доступа к содержимому.

PWA кэширует только явный список публичных файлов; /api не перехватывается service worker. Offline-запись и синхронизация не реализованы. Статическая упаковка Sites сохранена; она не разворачивает PostgreSQL и API автоматически.

## Интернет-демо по отдельному запросу

compose.demo.yaml запускает независимый стенд: отдельные PostgreSQL volume/ключи, web/API, шлюз общего кода и TLS WebSocket-туннель в Docker. У первичной базы нет маршрута в этот туннель. HTTPS origin текущей временной ссылки задаётся через .demo-runtime.env; Host/Origin не ослаблялись до wildcard. API-cookie становится Secure, RLS и серверная валидация остаются прежними.

Шлюз пропускает запросы после проверки отдельного восьмичасового cookie, затем приложение определяет браузерный профиль своим cookie. Общий пропуск не используется как patient_id. Туннель подключается к Tunnelmole по WSS с обычной проверкой TLS-сертификата. Небольшой адаптер опубликованного протокола использует только Node APIs, не устанавливает SDK и не отправляет его аналитику; health payload, cookie и URL запросов не логируются. Есть ограничения размера сообщения/ответа и числа одновременных запросов. Перезапуск туннеля может изменить URL; автоматическое продолжение доступа на другом hostname без обновления origin не выполняется. Управление — DEMO.md.

Поле контуров рисуется на клиентском GPU из исходного v4. Вне границ текстуры продолжаются её крайние цвета с переходом к исходной внешней палитре; это убирает стык и сохраняет одинаковый масштаб ниши. У исходной области нет blur/desaturation. В покое рендер-цикл не работает; скрытые страницы/вкладки не перерисовываются. CSS анимирует положение маскота и размер окна. Замеры — PERFORMANCE.md.

## Перед медицинским пилотом

Нужны проверенная идентификация/OIDC, восстановление и отзыв сессий, MFA врача, CareRelationship/Consent, авторизация каждой операции врача, HTTPS и Secure cookies, утверждённое управление ключами и ротация, резервное копирование с восстановлением, аудит без содержимого, миграции версий схемы и независимая проверка безопасности. Начальная схема создаёт новый том; последующие локальные изменения выполняются версионированными SQL-миграциями без очистки данных.

Врачебный кабинет имеет отдельное функциональное демо: ручные схемы с титрацией/историей, календарь приёмов и дневники с графиками на вымышленных данных в памяти. Настоящие врачебные назначения, связь с пациентами, защищённый чат, push, Apple Health и LLM-сводки не подключены. Справочник КР/ГРЛС реален, база взаимодействий пока не загружена. Точный перечень — TASKS.md. Применимые требования и размещение должны быть согласованы отдельно; текущий локальный MVP не является готовым медицинским сервисом.

## Ручные схемы лечения

В patient_entries добавлены medication-plan и medication-dose; содержимое и история зашифрованы тем же AES-GCM/AAD. Схема хранит единицы, силу таблетки, количество, времена, даты, связь с едой и этапы титрации. Сервер сверяет revision/expectedRevision под транзакционной блокировкой профиля. Дубликат того же сохранения идемпотентен, конфликт даёт 409.

ID приёма детерминирован по схеме, дню и времени. Название, дозировка и указания при отметке выводятся сервером из принадлежащей профилю схемы. Уже отмеченный приём сохраняет свой снимок при изменении или архивировании схемы. Этапы идут по календарным дням, пропуски не сдвигают даты. Старый patient_doses оставлен для обратной совместимости; новый интерфейс его не использует.

В обоих Compose-проектах перед web выполняется docker/migrations/001-medications.sql: транзакция, advisory lock и таблица schema_migrations, без очистки томов. Схемы вводятся пользователем вручную; доставки врачебного назначения, проверки доз или взаимодействий пока нет. Отдельное врачебное демо использует ту же валидацию ручных схем, не меняя эти записи.


## Исследовательский справочник и документы

Загрузчик GRLS имеет только исходящий доступ к официальному источнику и не имеет ключей базы. Отдельные CLI-импортёры с административным секретом записывают публичные документы, страницы, происхождение и оригинальные фрагменты. Runtime получает SELECT на knowledge. Миграции 002/003 пропускают уже применённые версии, чтобы повторный запуск web не блокировал фоновую разметку.

КР и инструкции читаются непрерывным текстом или как оригинальный PDF через отдельно загружаемый PDF.js. Исходники и контрольные суммы сохраняются. Геометрия букв/ячеек даёт таблицы, надстрочные знаки и абзацы; при несовпадении состава букв/цифр используется оригинальное изображение. PDF scripting/XFA/eval отключены; CSP осталась строгой. Шрифты и CMAP поставляются локально, API-документы не кешируются PWA.

Врачебная роль в URL — переключатель интерфейса. Она не открывает cookie-профиль пациента и не является авторизацией. Функциональные назначения и приёмы этой итерации остаются отдельным набором вымышленных данных React, с явной подписью срока хранения.

Latest reference/care layer adds `006-reference-catalogs.sql`, `reference-search.mjs`, `condition-search.mjs`, `disease-safety.mjs` and an offline `import-reference-catalogs.mjs`. Provider-native IDs are joined through reviewed ingredient identities; ICD source links remain separate from colloquial search aliases. `MeasuredDisclosure` measures suggestion content so open/close and result-count changes animate without replacing results on each keystroke. Browser fetch remains confined to `persistence.js`.

## Account ownership and journal privacy

Local accounts own fresh UUID principals; registration never adopts anonymous entries. Passwords use salted scrypt; email lookup is keyed HMAC and account/profile/consent payloads are encrypted. Role-specific cookies coexist, preserving old anonymous principals in separate HttpOnly backup cookies. RLS gates account rows and care relationships. Optional `X-Compass-Account` asserts expected UI ownership only and never grants permissions; mismatches reject before data reads/writes. An `auth-changed` notification carries only role and a temporary tab sender marker, without PHI and immediately unmounts the affected workspace in other tabs. Account-keyed components clear health data/drafts; pending onboarding intake is owner-bound.

Journal bodies are selected/decrypted for the physician only after global processing+sharing consent and an active care relationship. Consent changes are versioned, serialized and protected against stale windows. Medication workflows query only profile/plan/dose entry types, without decrypting private journal text. Chat ciphertext is bound to link/message IDs; link/account locks serialize reads/sends with revocation, UUID retries are idempotent, and timestamp+ID cursors preserve ordering.
