# Компас · список работ

Обновлено: 19 октября 2026. Исходный план составлен 17 октября. `[x]` — выполнено и проверено в указанном объёме; `[ ]` — ещё нет. Список обновлять при каждой следующей итерации. Выполненность интерфейса не означает готовность медицинского сервиса. Разделы 2–6 описывают требования к допуску защищённого пилота; реализованные локальные исследовательские сценарии и их ограничения перечислены в поздних разделах. Исторические макеты не являются текущими медицинскими функциями.

## 1. Согласованный дизайн и работающий frontend

- [x] Прочитать последние решения чата создания экрана и найти актуальный v7.
- [x] Сохранить исходные концепции, не заменять их новым дизайном.
- [x] Главная v7: цветная верхняя половина, широкие контуры, белый маскот, два напоминания.
- [x] Адаптировать сайт под телефон и десктоп без рамки телефона.
- [x] Четыре вкладки: Сегодня, Дневник, Лечение, Врач.
- [x] Живой вход к оценке состояния и по кнопке, и по маскоту.
- [x] Шкала от очень неприятного до очень приятного, выбор «сейчас / за день».
- [x] Синий → серо-зелёный → жёлтый, три выражения маскота, плавная смена сцен.
- [x] Уточняющие слова для текущего состояния, множественный выбор.
- [x] Факторы настроения; большие личные заметки отдельно в дневнике, сохранение в локальной PostgreSQL.
- [x] Отображение записи и контекста в дневнике.
- [x] Переключение дней, недели/месяца и соседних периодов, пустые дни.
- [x] Ручная запись длительности и качества сна.
- [x] Демо-план на два вымышленных препарата, независимые статусы, исправление отметок.
- [x] Полные PHQ-9/GAD-7 с проверенными русскими формами, подсчётом и сохранением результата; демоопроc из трёх вопросов удалён.
- [x] Вкладка врача с явными пояснениями о неподключённых функциях.
- [x] Установка приложения через манифест; инструкции на iOS, кнопка при доступном browser prompt.
- [x] Production service worker: только публичная статическая оболочка по allowlist.
- [x] Плавные открытия, закрытия, шаги, hover/focus и reduced-motion.
- [x] Проверить сборку, логику дат/записей/препаратов и ограничения хранения.
- [x] Сравнить с v7 бок о бок, исправить положение маскота, проверить 320/390/1440px и записать design-qa.md.
- [ ] Провести исследование понятности интерфейса с пациентами и врачом.
- [ ] Проверить доступность со скринридером VoiceOver и TalkBack на реальных устройствах.
- [ ] Проверить установку, safe area и клавиатуру PWA на физическом iPhone/Android.
- [ ] Проверить полный offline/update цикл service worker в браузере и на устройстве.

## 2. P0 · безопасность до реальных пациентов

### Уже сделано для демоверсии

- [x] Нет передачи внешним сервисам, внешних шрифтов, аналитики и трекеров; данные идут только в собственный локальный API.
- [x] Нет хранения записей в localStorage, sessionStorage или IndexedDB.
- [x] Пользовательский текст рендерится React как текст, без HTML-вставок.
- [x] CSP и защитные заголовки на production Node-сервере; deny framing, no-referrer, nosniff.
- [x] Камера, микрофон, геолокация, USB и платежи отключены Permissions-Policy.
- [x] В кэш PWA не попадают записи, сообщения, медицинские профили и произвольные ответы.
- [x] Production-сервер не пишет тела запросов, query и медицинские записи в логи.
- [x] Секреты и .env исключены из исходников и Docker-контекста.
- [x] Обновлены обнаруженные уязвимые зависимости; npm audit: 0 на момент проверки.
- [x] Составлена модель угроз, границы доверия и план допуска в SECURITY.md.

### Сервер, идентификация и разграничение доступа

- [ ] Выбрать регион размещения и согласовать условия обработки медицинских данных.
- [ ] Утвердить карту данных: цель, основание, доступ, срок хранения, удаление, подрядчики.
- [ ] Выбрать проверенный сервис идентификации или библиотеку сессий; не писать свою криптографию.
- [ ] Вход и восстановление доступа, защита от перебора и перечисления аккаунтов.
- [ ] MFA для врачей и администраторов, управление активными сессиями.
- [ ] Сессии в Secure/HttpOnly/SameSite cookies, без токенов в браузерном хранилище.
- [ ] CSRF-защита, ротация и отзыв сессий, срок простоя и повторный вход для чувствительных действий.
- [ ] Проверка авторизации на каждом API endpoint, запрет по умолчанию.
- [ ] Пациент видит только свои записи; врач — только активных назначенных ему пациентов.
- [ ] Связь врач–пациент и согласие на доступ отдельными сущностями, без доверия ID из браузера.
- [ ] Смена врача: атомарный отзыв старого доступа, выдача нового, аудит согласия.
- [ ] PostgreSQL RLS отдельной защитой; runtime-роль без обхода RLS и без прав владельца.
- [ ] Тесты чужих ID, других ролей, отозванного согласия и доступа после смены врача.

### Данные, инфраструктура и эксплуатация

- [ ] HTTPS на домене, закрытая БД, минимальные сетевые доступы, TLS до внешних сервисов.
- [ ] Шифрование БД/бэкапов и чувствительных полей с ключами вне БД, ротация и контроль доступа к KMS.
- [ ] Проверенные миграции, лимиты запросов, серверная валидация и идемпотентные отметки приёма.
- [ ] Резервное копирование, регулярная проверка восстановления, утверждённые RPO/RTO.
- [ ] Секреты через secret manager, раздельные dev/stage/prod, никаких реальных данных в тестах.
- [ ] Аудит чтения/изменения/экспорта медицинских данных без самих текстов записей.
- [ ] Редактирование PII в логах, запрет session replay и аналитики медицинских экранов.
- [ ] Удаление и экспорт с повторной идентификацией, учёт сроков бэкапов и требований хранения.
- [ ] Выход с очисткой клиентского состояния; Cache-Control: no-store на всех персональных API.
- [ ] Мониторинг аномального доступа и инцидентов; отзыв ключей/сессий и проверенный регламент реагирования.
- [ ] Сканирование зависимостей и секретов в CI, фиксированные версии, обновление базовых образов.
- [ ] Независимая проверка безопасности и устранение критичных замечаний до пилота.
- [ ] Согласовать роли ответственных, документы, соответствие применимым требованиям со специалистом.

## 3. Защищённый MVP пациента после P0

- [ ] Вход, аккаунты и связь с врачом поверх реализованного Node API/PostgreSQL; окончательный стек пилота утвердить отдельно.
- [ ] Устойчивое хранение дневника, серверное время и часовой пояс пациента.
- [ ] Назначения врача: препарат, дозировка, расписание, начало/конец, журнал изменений.
- [ ] Титрация только в рамках утверждённого врачом плана, без автоподбора доз.
- [ ] Надёжный журнал приёма с идемпотентностью, повторами и обработкой офлайн-конфликтов.
- [ ] Назначение опросников врачом, календарь сроков и сохранение ответов.
- [x] Выбрать PHQ-9/GAD-7, проверить русские формы, права и подсчёт; ASSESSMENTS.md.
- [ ] Утвердить клинический протокол сопровождения и реакции врача на результаты.
- [ ] Обратная связь врача после отметок состояния, без автогенерации лечения.
- [ ] Чат: доступ, хранение, доставка, непрочитанное, часы ответа и правила экстренных обращений.
- [ ] Профиль препаратов, хронических заболеваний, аллергий и подтверждение источника сведений.
- [ ] Смена специалиста с подтверждением пациента и серверным отзывом доступа.
- [ ] Web Push: согласие по действию пользователя, зашифрованные подписки, очередь и отзыв.
- [ ] Нейтральные push-тексты без имени препарата/диагноза/текста дневника на экране блокировки.
- [ ] Проверить push на реальных устройствах и показать, что доставка не гарантирована.
- [ ] Решить путь Apple Health: отдельная нативная интеграция/обёртка, если она понадобится; прямой доступ не имитировать.

## 4. Кабинет врача

- [ ] Список пациентов, медицинская карта, лечение и вложения.
- [ ] Инфографика приёма препаратов, выполнения опросников, состояния; различать отсутствие данных и плохое состояние.
- [ ] Календарь приёмов, часовые пояса, занятость и подтверждение записи.
- [ ] Просмотр дневника за период с точными исходными отметками и контекстом.
- [ ] Полноценный врачебный интерфейс в согласованном стиле и тесты ролей.

## 5. Зависит от отсутствующих источников и решений

- [ ] Справочник клинических рекомендаций: проверить официальные источники, версии, обновления и права.
- [ ] Инструкции к препаратам: связать точный препарат/форму/инструкцию с источником.
- [ ] Взаимодействия лекарств: проверенная база, покрытие, качество, уровень уверенности, подтверждение врачом.
- [ ] LLM-систематизация дневника: согласие, размещение модели, минимизация данных, ссылки на записи.
- [ ] Оценить ложные тревоги и пропуски; не выдавать сгенерированный симптом за установленный факт.
- [ ] Не отправлять медицинские записи в публичную LLM по умолчанию.
- [ ] Продумать тревожную кнопку и проверенные контакты для региона вместе с клинической командой.

## 6. Подготовка и выпуск

- [x] Production-сборка и отдельный сервер статических файлов с защитными заголовками.
- [x] Инструкции для HTTPS-домена, Dockerfile и пример reverse proxy.
- [ ] Выбрать постоянный хостинг/домен. Временный отдельный демостенд для коллег описан в разделе 10.
- [x] Проверить локальные Docker Compose: приложение и PostgreSQL, постоянный том, loopback-порт.
- [ ] Проверить Docker/runtime в выбранной публичной инфраструктуре после отдельного решения о размещении.
- [ ] Повторить security headers / CSP / PWA проверки на реальном HTTPS-домене.
- [ ] Провести функциональные, ролевые, нагрузочные и recovery-тесты защищённого MVP.
- [ ] Утвердить пилот с синтетическими данными; реальные данные разрешать только после P0.

## 7. Исправления после просмотра прототипа

- [x] Сохранение на выбранный день дневника; отдельно observation day и createdAt.
- [x] Вчерашняя запись не меняет состояние на главной за сегодня.
- [x] Редактирование записи дневника без дублирования, с сохранением даты и времени.
- [x] В форме с главной нет даты: только сегодняшний день. Прошлый день выбирается в дневнике.
- [x] Убраны видимые подписи «Шаг 1 из 3» и аналогичные.
- [x] Отдельное плотное портретное окружение маскота, продолжающееся за заголовком, шкалой и кнопками, без внутренней верхней/нижней границы.
- [x] Раздельные raster body/face assets; плавное движение рта и бровей, глаза не переворачиваются.
- [x] Семь палитр и непрерывная интерполяция через промежуточные состояния.
- [x] Шкала по присланному Apple Health Summary.png: широкая полупрозрачная дорожка без заполнения, крупный белый бегунок.
- [x] Ползунок и фон меняются во время удержания, не только при отпускании; проверено в браузере до mouseup.
- [x] Нейтральная палитра светлее соседних неприятных состояний; кнопка и индикатор плавно меняют цвет по непрерывной координате.
- [x] Маскот и его окружение уменьшаются общей группой без пересоздания при переходе к словам эмоций.
- [x] Новое расширенное окружение v4: редкие чёткие внешние контуры продолжаются за словами, без растушёвки по бокам.
- [x] Фон увеличен на 24% относительно предыдущей итерации; центр уточнён по форме ниши вокруг головы и ног.
- [x] Тонкий прогресс перенесён над заголовком «Ваше состояние».
- [x] Скользящая подложка переключателя «Прямо сейчас / За весь день».
- [x] Единая высота всех экранов и последовательное затухание/появление содержимого; отмена motion по системной настройке.
- [x] Поле личной заметки убрано из отметки состояния; большие тексты пишутся в самостоятельном дневнике по последнему решению.
- [x] Стабильное открытие редактора: без scale окна, без повторного позиционирования в animationend, с предварительной загрузкой фона и показом после первой отрисовки.
- [x] Убрана светлая обводка редактора и уменьшена внешняя тень.
- [x] Главная: та же привязка внутренней ниши к маскоту и дополнительные видимые слои возле «Сегодня» и состояния; проверено на 390px и 1280px.
- [x] Убрано уменьшение фона до 420px: отрисовка в исходных 971×1619. Сохранён согласованный неглубокий v4; рельефный v5 не используется по просьбе пользователя.
- [x] Регрессионные проверки дат, палитр, глаз, геометрии и непрерывных акцентов; 17 прикладных/security + 4 packaging проверки проходят.

## 8. Дневник, лечение, врач и новые формы

- [x] Самостоятельные длинные записи до 20 000 символов, поиск, редактирование и сохранение даты.
- [x] Простая читаемая Notes-подобная лента; полный текст открывается в редакторе.
- [x] Оформить лечение и врача в общем стиле, независимые статусы препаратов и честные заглушки неподключённых функций.
- [x] Сохранять состояние разделов без движения страниц; убрать slide-переход самих страниц.
- [x] Исправить квадратный hover у «Написать врачу»; форма кнопки сохраняется.
- [x] Собственный календарь с месяцами/годами, запретом будущих дат, «Вчера»/«Сегодня», клавиатурой и Escape.
- [x] Переработанные колёсики сна: нативная прокрутка, непрерывная геометрия цифр, клавиатура, ограничения 24:00.
- [x] Общая живая палитра всех разделов и форм, включая бумагу дневника без фиксированной желтизны; возврат палитры при отмене, исторические состояния не перекрашиваются.
- [x] Полные PHQ-9/GAD-7, точные русские формы и все исходные вопросы.
- [x] Отдельный функциональный вопрос PHQ-9 вне суммы, поддерживающая подсказка при любом положительном пункте 9.
- [x] Клиентский и серверный подсчёт, неизменяемые сохранённые результаты, чтение ответов в дневнике.
- [x] Сократить визуальный шум опросников: один вопрос, четыре ответа, тихий прогресс; маскот без отдельной карточки в отведённом месте над вопросом.
- [x] Компактный выбор шкалы без пустого низа; плавное расширение к фиксированному окну теста и плавный переход к результату.
- [x] Одинаковая высота всех вопросов, включая дополнительный PHQ-9; длинный текст прокручивается внутри, заголовок и footer остаются на месте.
- [x] Единый фон с нишей под маскота на входе и результате опросника: контуры выходят за внутренний блок к заголовку и кнопкам; между вопросами остаются тихими.
- [x] Проверить плавное перемещение маскота вверх к вопросам и обратно к результату; маскот и фон прокручиваются вместе с содержимым, header/footer сохраняют положение.
- [x] Убрать начальное переползание, унифицировать масштаб с редактором настроения и продолжить фон за исходный край без линии слева.

## 9. Локальное постоянное хранилище

- [x] Node API того же origin и PostgreSQL 17 в Docker Compose; основная база остаётся локальной, внешний демостенд отделён.
- [x] Сохранение дневника, настроения, сна, полных результатов шкал и дневных статусов демопрепаратов.
- [x] Случайный локальный профиль через HttpOnly/SameSite cookie, хеш токена в БД; отдельные профили разных браузеров.
- [x] Origin/Host/CSRF, параметризованные SQL, лимит тела и rate limit, серверная валидация.
- [x] Шифрование содержимого AES-256-GCM, ключ отдельно от БД, связь ciphertext с профилем и записью через AAD.
- [x] Non-owner runtime role, FORCE RLS; реальные проверки default deny, чужого чтения/записи и сброса контекста транзакции.
- [x] Не показывать успех до ответа сервера; ошибки сохраняют введённый текст и результат в форме.
- [x] Обновление сохранённых записей между вкладками через сигнал без медицинского содержимого; черновики форм не сбрасываются.
- [x] Проверить сохранение API и cookie-сессии после перезапуска обоих контейнеров.
- [ ] Полноценный вход/восстановление/отзыв доступа, HTTPS Secure cookies, роли врача, дальнейшие миграции, KMS/ротация, бэкапы с восстановлением и допуск реальных пациентов — остаются P0.

## 10. Отдельная демоверсия для коллег по прямому запросу

- [x] Отдельный Compose-проект, PostgreSQL volume и ключи; основная локальная база не публикуется и не копируется.
- [x] Временный HTTPS-доступ к серверу на компьютере через Docker TLS WebSocket-туннель; без открытия портов роутера и без личных SSH-ключей.
- [x] Код входа, HttpOnly/Secure/SameSite cookie демодоступа, лимит попыток, строгий Origin, изолированные cookie-профили API.
- [x] Проверить интернет-API: сохранение, повторное редактирование, изоляция двух профилей, CSRF/Origin, Secure и no-store.
- [x] Проверить реальный браузер: вход, вымышленная запись, обновление страницы и повторное чтение.
- [x] Измерить объём ресурсов, память контейнеров и главный поток браузера; PERFORMANCE.md с границами измерений.
- [ ] Реальные iPhone/Android и нагрузка большой многопользовательской системы пока не проверены.
- [ ] Постоянный домен, стабильный хостинг и допуск реальных пациентов требуют отдельного этапа.

## 11. Актуальная локальная итерация и новая демоверсия

- [x] Читаемые результаты независимо от настроения, спокойная поддержка, аккуратные ответы и источник.
- [x] Мягкое закатное золото; все поверхности следуют общей палитре.
- [x] Тесты в меню «+», отдельная кнопка личной записи; календарь со скользящим выбором, анимацией высоты и перелистывания.
- [x] Удалены старые рендеры, неиспользуемая графика и прежние QA-снимки; активные ресурсы сохранены. На этом этапе GitHub не менялся; позднее пользователь отдельно разрешил финальный commit/push.
- [x] Ручные схемы препаратов, редактирование/архив, ежедневное время, единицы, дозировка и количество.
- [x] Титрация: тумблер, плавное раскрытие, периоды и дозы этапов, продолжение/завершение.
- [x] Связь с едой; прочерк по умолчанию скрывает указание. На главной — предстоящие приёмы, время, количество, отметка; прошедшие напоминания убираются.
- [x] Шифрованное сохранение схем и приёмов, ревизии/история, снимок дозы с сервера, миграция без сброса данных.
- [x] Мг/мкг непосредственно перед дозировкой; лицо SVG постоянной толщины, штрихи короче на 12%.
- [x] Прогресс теста: 2px, верхний отступ и боковые поля как в настроении, без видимых PHQ-9 и 1/9.
- [ ] Создание/подтверждение назначений врачом, роли, проверка взаимодействий, фоновые push и медицинская эксплуатация.

Публикация той итерации по прямому указанию пользователя проверялась только на запуск сайта. Проверки следующих локальных изменений перечислены ниже; отдельный интернет-демостенд не обновляется.

## 13. Исторический этап: UX/UI кабинета врача · 18 октября 2026

Это запись первоначального этапа с вымышленными примерами, а не текущий статус. Позднее демонстрационные пациенты и приёмы убраны из рабочего кабинета; локальные подключения, назначения, справочники, аккаунты и чат описаны в разделах 17 и ниже. Клинический допуск и требования раздела 2 остаются открытыми.

- [x] Прочитать требования чата «Создать MVP интерфейс» и действующий пациентский интерфейс.
- [x] Общий вход с выбором врача / пациента, прямые локальные адреса #doctor / #patient, возврат к выбору роли.
- [x] Обзор дня: сводка, поводы обратить внимание, новые записи и ближайшие приёмы.
- [x] Список вымышленных пациентов, поиск, фильтры, пустой результат.
- [x] Медкарта: обзор, динамика настроения, отдельное отсутствие данных, отметки препаратов, сон и примеры результатов опросников.
- [x] Макеты лечения, этапов титрации, цикла наблюдения, дневника, документов и сведений о пациенте.
- [x] Макет периодичности опросников и доступа при смене врача без сохранения/изменения прав.
- [x] Календарь дня / недели, переход по датам и пустые дни, просмотр карты из приёма.
- [x] Структура справочника с поиском по разделам; явное отсутствие проверенных медицинских материалов.
- [x] Макет сообщений без искусственной переписки и отправки.
- [x] Адаптивные варианты, клавиатурный focus, reduced motion, возврат фокуса из окон.
- [ ] Подключить реальную авторизацию врача и связь с пациентами после отдельной задачи.
- [ ] Подключить все врачебные действия, источники и обмен данными после отдельной задачи.

## 14. Реальный исследовательский справочник · 18 октября 2026

- [x] Подтверждён некоммерческий исследовательский сценарий.
- [x] 33 оригинальных КР из полного каталога Минздрава с любым F00–F99, версии, хеши, страницы и полнотекстовый индекс.
- [x] Полная выгрузка ГРЛС как метаданные: 126 861 уникальная запись всех статусов, 3 745 названий составов; отличать от числа инструкций.
- [x] Источник инструкции проверяется по точному РУ, сохраняются оригинал и карточка, несколько редакций не объявляются автоматически последней.
- [x] Возобновляемый сбор и фоновый импорт в отдельную схему knowledge, read-only API без данных пациентов.
- [x] По последнему указанию остановлена широкая очередь, пересобран отбор только для психиатрии; проверяемый список и причины включения.
- [x] Завершить проход психиатрической очереди; случаи без файла и ошибки источника показаны отдельно.
- [ ] Разобрать 3 ошибки источника и OCR сканов; не объявлять их готовыми.
- [ ] Получить отдельную официальную выгрузку DDInter: прямой сервер по-прежнему недоступен, файл требует собственной проверки происхождения и условий. Это не означает отсутствие взаимодействий в приложении: позднее импортирован корпус OpenMRS/DDInter — 295 183 прямые пары и 8 268 записей о заболеваниях, см. текущий статус ниже и KNOWLEDGE.md.
- [ ] Экспертная проверка формуляра, извлечения, редакций, правил, доз и клинических сценариев. Медицинская эксплуатация не разрешена.

## 15. Чтение клинреков и поиск

- [x] Непрерывный полный текст без перелистывания; исходное оглавление и поиск прокручивают к разделам/подразделам и страницам.
- [x] Абзацы вместо PDF-переносов, отдельные списки/уровни доказательности, контроль сохранности исходного текста всех 33 документов.
- [x] Поиск слова/части слова/фразы по всему клинреку, регистр и е/ё, контекст, подсветка, счётчик, стрелки и Enter/Shift+Enter.
- [x] Размер текста, адаптивная навигация, исходный текст страницы и оригинал PDF с текущей страницы.
- [ ] Клиническая редактура сложных таблиц и OCR сканов без изменения исходных оригиналов.

## 16. Исторический этап: исходные PDF, инструкции и рабочие сценарии врача

Этот раздел фиксирует переход от макета к отдельному вымышленному демо. Демонстрационное создание приёмов не является подключённым календарём: в текущем кабинете общий календарь пациента показывает честное отсутствие сохранения приёмов. Рабочие локальные подключения и назначения описаны в разделе 17 и поздних обновлениях; авторизация и чат — в разделе аккаунтов. Реальное клиническое применение не заявляется.

- [x] Разметка всех 33 КР по геометрии PDF, реальные ячейки таблиц, примечания и проверка сохранности букв/цифр; оригинальные изображения для сложных областей.
- [x] Общий непрерывный читатель для инструкций и КР; исходный текст сохраняется отдельно, неразобранные колонки не склеиваются.
- [x] Режим PDF с собственными поиском, выделением, масштабом, навигацией и исходным оформлением; без зависимости от плагина браузера.
- [x] Раздельные счётчики МНН/составов, регистраций и файлов; готовые инструкции первыми, психиатрия по умолчанию.
- [x] Обработать всю очередь 1 374 регистраций; сохранить явные 224 случая без документов и 3 ошибки источника, не выдавать их за готовые инструкции.
- [ ] OCR и экспертная проверка сканов/ошибок источника, подтверждение применимости редакций.
- [x] Перенести общий календарь с анимацией, выбор даты, колёса времени, редактор препарата/титрации и скользящие переключатели во врачебное демо.
- [x] Создание, просмотр перед сохранением, редактирование, версии и завершение схемы лечения для отдельного вымышленного пациента.
- [x] Дневник настроения/сна по датам, графики с пропусками, выбор дня из графика, длительность сна по имеющимся записям и распределение категорий настроения.
- [x] Создание демо-приёма с проверкой пересечений, отображение в календаре дня/недели.
- [ ] Допуск настоящих пациентов и клиническая проверка личности/квалификации врача. Историческое ограничение этого этапа на записи в памяти позднее заменено разрешёнными локальными синтетическими профилями, серверными согласиями и аудитом; это не допуск к медицинской эксплуатации.

- [x] Просмотр доступных вымышленных личных записей с поиском, PHQ-9/GAD-7 с исходными ответами и проверенным общим расчётом.

## 17. Подключённые профили и назначения, 18.10.2026
- [x] Проверить завершение психиатрической загрузки: 1 374 регистрации обработаны, 1 922 инструкции в БД; 224 регистрации без документов и 3 ошибки источника учтены отдельно.
- [x] Повторить прямое скачивание DDInter с официального сайта; сохранить явный результат тайм-аута без замены зеркалом.
- [x] Медицинский профиль пациента: уже принимаемые препараты и хронические заболевания, поиск ГРЛС или ручное название, сведения со слов пациента, шифрование и оптимистические версии.
- [x] Одноразовый код подключения, именованный запрос врача, подтверждение и отзыв доступа пациентом; проверка отношения на сервере, RLS, CSRF и аудит.
- [x] Редактор назначения с выбором конкретного РУ/инструкции, просмотром схемы, источниками предупреждений и передачей в «Лечение» пациента с сохранением происхождения и истории.
- [x] Проверка ограничений: реальные разделы инструкций, полные фрагменты и PDF, отсутствие ложного заключения о безопасности, повторная проверка при изменении сведений пациента или предлагаемой схемы.
- [x] Подготовить отдельный словарь русских/английских действующих веществ, полного состава, солей/форм и ID DDInter; не допускать перевод или неполное сопоставление к DDI-проверке.
- [ ] Получить официальную выгрузку DDInter, наполнить словарь с источниками и экспертной проверкой, проверить актуальность применимых инструкций и клинических правил.
- [ ] Подтверждение личности/квалификации врача, клиническая авторизация, эксплуатационные согласия и юридический электронный рецепт для реального применения. Локальный прототип этого не обеспечивает.

## Latest connected-care/reference revision
- [x] Permanent patient code and separate patient/doctor cookies in one browser, with consent gate.
- [x] Real connected patients replace fictional overview cards.
- [x] Physician edits current therapy and diagnoses with encrypted revisions, attribution/history and patient refresh.
- [x] Trade-name/INN autocomplete with explicit second-step GRLS product/registration selection; bulk pharmaceutical substances excluded from prescribing suggestions.
- [x] ICD-10 diagnosis catalog, common-language search aliases and adult-first ranking.
- [x] Shared animated suggestion disclosure and result-count resizing for diagnoses and medicines; stale choices disabled.
- [x] OpenMRS direct DDI + disease corpus imported with pinned provenance and quality controls: 295,183 direct drug pairs and 8,268 distinct drug–disease rows. Clinical identity coverage is partial (40 reviewed INNs); the separate official DDInter download remains pending.
- [x] Wrapped recommendation class retained in the evidence block; embedded PDF fonts enabled.
- [x] Verbose GRLS download progress removed from the product view; sliding library selector.
- [ ] Production identity verification, medical certification, clinical validation and complete reviewed multilingual mapping remain outside this local research prototype.
- [x] Smooth measured height of the complete medical-profile dialog across medication/condition switches, record changes and editor disclosure; fixed save footer and styled inputs.

## New queue requested 18 October (continue before final Git push)
- [x] One current-medication list derives from physician prescriptions, manually added therapy and reconciliation; reversible removal preserves history and source authorship.
- [x] Patient medication-management entry in Treatment/settings; disease names remain inside private medical-details editor, with convenient add/remove controls at the top.
- [x] Compact safety alerts: one source sentence containing the named condition, full context/source behind details, preserve negation and original language.
- [x] Normalize private-use PDF bullet glyphs and similar extraction artifacts into standard bullets without rewriting medical prose; originals unchanged.
- [x] PDF smaller initial zoom, working scale controls across guidelines and instructions, continuous navigation/search/selection preserved.
- [x] From unambiguous GRLS solid-form strengths, prefill smallest registered tablet/capsule strength and quantity 1 as editable source facts; no inferred treatment dose, no conversion of ambiguous compounds/liquids.
- [x] Reuse patient calendar/components/tokens throughout physician workspace; preserve care drafts and access boundaries.
- [x] Dedicated bilingual drug/disease catalog (official EAEU naming snapshot and existing ICD crosswalk; full clinical identity coverage still pending): English names + source IDs retained, Russian display/search translations separated from source-verified clinical identity mappings. User repeated this as a priority queue item. Investigate primary multilingual identifiers/crosswalks, broaden supported names, explicitly flag unresolved mappings; no fuzzy/LLM matching as medical fact.
- [x] Authorized source commit 83b103d pushed to origin/main on 19 October 2026 after build, 88 tests, synthetic API checks and visual QA. Secrets, patient data, raw/processed corpora, QA screenshots, Python caches and unrelated design-directory changes were excluded.

- [x] DDI checking for GRLS medicines with no downloaded instruction: confirmed substance/provider identity is resolved independently of PDF availability. EAEU display labels do not establish clinical identity; complete reviewed components/provider IDs remain required. Synthetic reference-care verification checks an actual no-PDF registration, returns source DDI matches, document=null, instruction screening unavailable and safeToCombine=null. No prescription was created from that historical registration; ambiguous salts/combinations and missing pairs remain gaps.
- [x] Official EAEU INN catalog 1016 downloaded in full through documented /api/v1: 9,578 RU/EN terms, 9,573 Latin terms (5 missing in source), page reports update 26.11.2025. Validated paging, unique codes and hashes; offline importer keeps naming separate from the 40 reviewed provider identities.

## Accounts and remaining workflows · 19 October 2026

The following items are functional local research workflows tested with synthetic profiles. They do not establish production identity verification, medical licensing, a legally valid electronic prescription or operational clinical readiness.

- [x] Local registration/login/logout with scrypt password hashes, isolated account ownership and fixed patient/doctor roles; CSRF checks, session rotation, generic login failures and attempt limits. Existing anonymous health records stay in a separate local profile and are not silently adopted by a registered account.
- [x] Introductory registration steps: app overview, name/surname, patient age, optional medications/diagnoses through the shared source pickers, explicit health-data storage consent and separate journal-text processing/sharing permissions defaulting off. A failed optional intake save retains the authenticated account and a retryable medical-profile draft.
- [x] Journal sharing requires both optional permissions and an approved active care relationship. Settings can revoke either permission; revoking health-data consent blocks new medical writes and physician access while preserving the patient's own access to saved history. Automatic journal-text analysis remains unconnected.
- [x] Auth mascot and continuous contour background reuse the patient's native texture, pocket geometry and figure. Patient login includes a flight into the measured home position with a reduced-motion fallback; doctor login opens the workspace.
- [x] Real encrypted chat along active approved care relationships: server-derived sender, React-only drafts, polling, idempotent sends, pagination and server-side revocation enforcement. No artificial replies, push delivery, unread counters or guaranteed response time are claimed.
- [x] Automated verification: 88 unit/security/domain tests pass. Synthetic auth, care-chat and reference-care API scenarios pass, including separate role cookies, account isolation, login persistence, consent-gated journal visibility/revocation, chat delivery and document-free DDI checking. No tests write to the user's browser patient profile.
- [x] Primary-interface walkthrough of registration, login, settings and patient mascot arrival completed with a synthetic account. Successful registration and private-by-default permissions were checked in the running local app.
- [x] Cross-tab logout immediately returns both open tabs to the account gate. Mobile auth at 360px has no horizontal overflow; desktop and mobile visuals were inspected.
- [x] Final authorized source Git push completed: 83b103d is on origin/main; this completion note follows in a documentation-only commit.
- [ ] Production email verification/password recovery, clinician identity and qualification verification, MFA/session management, legal consent documents, clinical validation and operational deployment.
- [ ] Appointment creation/confirmation/storage, clinician-assigned questionnaire schedules, reliable background notifications, unread-message counters and the remaining unconnected workflows. The current calendar is a shared interface with an explicit empty state.

## Authentication visual correction, 19 October 2026
- [x] Remove role landing page; common login discovers saved role, registration uses the shared sliding role control.
- [x] Animate measured auth-card height, registration disclosures, errors and onboarding content without losing drafts.
- [x] Replace detached mascot flight with one persistent texture/figure composition and a measured, painted home handoff; desktop/mobile and reduced motion verified.
- [x] Build, 96 tests, targeted synthetic account/consent/chat regression checks and live visual verification. Source commit/push follows after final review.

## Latest priority: English INN participates in interaction lookup
- [x] Recompute and import 813 additional exact EAEU/provider/RxNorm identity chains with hashes, no PDF prerequisite, no salt stripping or combination guesses. Existing 40 links preserved; 69/136 psychiatry names map and 67 retain explicit gaps.
- [x] Visible RU/EN/source-ID status in product cards, combination checks and physician safety report; live public-reference regression checks passed, including real no-PDF registration.
- [x] Fix auth content/shell timing with a single measured resize and matching row movement; intermediate DOM geometry and screenshots checked in both directions. At the measured expansion frame, the button moved 199.46px while the shell expanded 199.70px.

## Manual identity review and GRLS / ESKLP clarification
- [x] Review all 67 remaining psychiatry names manually with primary naming references and pinned provider records. Add 8 full compositions (2 with two components); retain 59 explicit gaps: absent 33, incomplete 15, form unresolved 10, source conflict 1. All 67 have English names or explicitly descriptive composition labels.
- [x] Import reviewed public knowledge only. Overall 861 registry compositions, including 77/136 psychiatry names; 1,463 registry names have English display labels. Retain chemical-form notes, original IDs and primary/GRLS evidence. Block Galantamine/benzgalantamine source conflict.
- [x] Full local build and 96 tests pass. Live exact/manual crosswalk checks and synthetic account/consent/chat regression pass. Missing PDF does not block confirmed ingredient lookup; absence of a pair still returns safeToCombine=null.
- [x] Inspect original GRLS Excel column J: Russian INN/group/chemical name is already imported. No separate English/Latin column in this snapshot. Explain distinction between international naming and English language.
- [x] Import supplied ESKLP and NSI 1367 files after initial web access failed; preserve RU, SMNN/KLP/ingredient IDs, languages, versions and hashes. The user supplied both archives on 19 October; see the completed import below.

## Supplied ESKLP + NSI 1367 · 19 October 2026
- [x] Locate supplied ESKLP archive in Downloads, preserve it under ignored public raw storage, parse all 9 KLP parts plus SMNN/trade-name sheets with fixed schema/header/count/date checks. 7,645 SMNN, 589,326 KLP, 42,393 trade-name rows; 21 flagged SMNN excluded from links.
- [x] Import isolated public-reference tables transactionally. Exact RU/trade links cover 101,927 GRLS records (97,577 without PDF); 9,007 differing INN labels retain explicit source status and cannot change DDI identity.
- [x] Import user-supplied NSI 1367 version 5.18: 14,244 terms, 12,911 English, 12,886 Latin, 138 records with explicit alternatives. Preserve source IDs, code fields, missing values and hashes. Add 572 previously missing GRLS English labels without overwriting prior naming.
- [x] Add 66 strict NSI/provider/RxNorm identities; total 927 registry identities, psychiatry unchanged at 77/136. Explicit alternatives and differing EAEU names do not approve a link; existing manual conflicts remain blocked.
- [x] Wire source IDs/versions/Latin labels into shared product/interaction mapping, catalog forms/codes into product cards, Latin/official aliases into suggestions, full KLP/SMNN code search into product search.
- [x] Verify running no-PDF example (potassium iodide), new caffeine/theophylline source pair, Paroxetinum suggestions, KLP code lookup, preserved galantamine conflict and visible NSI RU/EN/Latin/source IDs plus ESKLP card. 99 tests pass. Source commit/push follows verification.
- [ ] For future automated ESKLP refreshes, use the officially recommended XML format. No XML file is claimed imported.

## Shared database and reference performance · 19 October 2026
- [x] One shared PostgreSQL catalog with original GRLS IDs, indexed multilingual terms, normalized registrations, precomputed counts and ordered browsing. Original source/identity/provenance tables remain authoritative.
- [x] Import-side publication hooks, serialized dictionary writes, atomic read-model publication and rollback verification; runtime remains read-only. No patient-data cache.
- [x] Build and 102 tests pass; eight baseline plus 18 edge responses match. Search median falls from 315–830 ms to 2–8 ms locally. Public smoke load: 32 reads, eight workers, zero errors, p95 55.1 ms. Evidence and reproduction: REFERENCE-PERFORMANCE.md.

## Broader chronic medication coverage · 19 October 2026
- [x] Full registry visible by default in the physician library; psychiatry is an optional explicit filter. Correct whole-corpus counts and retain ready-instruction ordering.
- [x] Exact INN first in the shared picker, even when competing partial/composition records have missing English names. Explicit trade-name/active-ingredient input; INN selection opens the corresponding registrations. Live checks pass for allopurinol, atorvastatin, rosuvastatin, simvastatin, pitavastatin, metformin and losartan.
- [x] Separate chronic collection: 465 full INNs/compositions, one first-pass registration each, 4,448 eligible current registrations; 1,056 source-derived search aliases. Preserve original source evidence and all clinical identity gaps.
- [x] Start resumable official GRLS downloads and automatic import into the shared database; priority allopurinol/statin PDFs verified available. New PDF batches update availability/counts without rewriting language dictionaries.
- [x] Build, 103 JavaScript tests, six Python tests, source-only PDF add/remove publication and clinical-identity regression checks pass. Fix empty research-profile null intake discovered in UI verification.
- [x] Actual UI verification on isolated loopback origin/cookie: empty research patient opens; “розувастатин” yields exact INN first; choosing it shows Липопрайм/Кардиолип/Крестор registrations and selecting a product completes the shared picker. Close without saving the synthetic treatment draft. Full-registry statin search verified in doctor UI; screenshots retained only in ignored QA storage.
- [ ] Complete the running chronic download queue and inspect remaining explicit source errors/unavailable registrations. Target count is not a completion claim; no other brand's PDF is substituted.
