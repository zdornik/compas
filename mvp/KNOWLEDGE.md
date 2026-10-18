# Справочник врача · исследовательский корпус

Локальный справочник читает реальные опубликованные документы. Он не создаёт назначений и не связан с данными пациентов. Пользователь подтвердил некоммерческое исследовательское использование. Интернет-демоверсия не обновлялась.

## Источники и фактический охват

- [Рубрикатор Минздрава](https://cr.minzdrav.gov.ru/clin-rec): из полного ответа каталога в 772 записи отобраны 33 действующих документа, в которых встречается код F00–F99. Это включает смежные специальности. PDF получены через официальный `apicr.minzdrav.gov.ru`; сохранены исходные файлы, хеши, версии, коды МКБ и постраничный текст.
- [ГРЛС](https://grls.minzdrav.gov.ru/grls.aspx): официальный ZIP/XLSX, снимок 16.10.2026. В выгрузке 143 283 строки; после удаления точных повторов в БД 126 861 запись и 3 745 названий МНН/групповых составов. Это регистрационные сведения со всеми опубликованными статусами, а не количество лекарств или инструкций. Исторические изменения сохранены.
- Инструкции: поиск точного регистрационного номера в ГРЛС → карточка этого РУ → её собственный список инструкций → оригинальные PDF/JPEG/PNG с официального сервера. Сохраняются ссылка, номер РУ, подписи источника, дата получения и SHA-256. Несколько файлов в карточке не объявляются автоматически текущей редакцией. Сканы без текста помечены `ocr_required`; OCR не имитируется.
- [DDInter 2.0](https://ddinter2.scbdd.com/download/): прямая официальная выгрузка пока не получена. Отдельный корпус OpenMRS уже импортирован: 295 183 прямые пары взаимодействий и 8 268 уникальных строк ограничений по заболеваниям; происхождение и ограничения описаны ниже. Официальный сервер скачивания не отвечает из текущей сети, в том числе из загрузчика Docker. Сторонние файлы не выдаются за прямую официальную выгрузку DDInter. [Условия](https://ddinter2.scbdd.com/terms/) CC BY-NC-SA 4.0 допускают подтверждённый исследовательский сценарий, но не дают основания объявлять данные полными или разрешать коммерческое использование.

## Загрузка только для психиатрии

По последнему указанию пользователя широкая очередь из 6 045 регистраций остановлена. `prepare-psychiatry.py` создаёт новую очередь, а загрузчик отказывается запускаться без явной области `psychiatry`.

Отбор использует основные фармакотерапевтические группы ГРЛС: антипсихотики, антидепрессанты, анксиолитики, снотворные и связанные психотропные группы. Отдельно перечислены МНН нормотимиков, средств для лечения зависимостей, деменции и некоторых вспомогательных средств. Полный список и причина включения каждого названия находятся в `knowledge/psychiatry-scope.json`. Это проверяемая область сбора, не утверждённый клинический формуляр и не автоматическое заключение о показаниях. Неоднозначные названия составов не разбиваются на вымышленные компоненты.

Из целей исключаются исторические/приостановленные статусы, аннулированные и истёкшие на дату снимка записи. Один регистрационный номер загружается один раз; разные РУ не объявляются взаимозаменяемыми. Остальные препараты, в том числе вакцины, противовирусные и антибиотики, в новую очередь не входят. Уже полученные оригиналы не удалялись; повторные загрузки используют локальный архив. Полный реестр остаётся метаданными для поиска.

В самом приложении число файлов и прогресс читаются из БД, а не из этой документации. Регистрация может содержать несколько оригиналов. Наличие записи ГРЛС не означает, что инструкция уже скачана.

## Чтение клинреков

КР читается непрерывным документом без перелистывания. Оглавление и поиск прокручивают к нужному месту, а не заменяют текст. Вводные страницы собраны в раскрываемом блоке. Оглавление строится из исходного оглавления PDF. Если в нём отсутствует номер страницы или повреждена закладка, переход ищет соответствующий заголовок в тексте. Это автоматическая навигация; для сложных PDF сохраняется прямой переход к любой странице и оригиналу.

Текст разбит на абзацы с объединением переносов, сохранением слов, отрицаний, доз и обозначений источника. Выделены заголовки, списки и исходные строки уровней доказательности. Табличный текст не превращается в вымышленные ячейки; у таблиц и каждой страницы есть ссылка на соответствующую страницу PDF. Исходный извлечённый текст также доступен в раскрытии.

Поиск внутри документа ищет буквальное слово, часть слова или фразу по всем страницам, независимо от регистра и е/ё. Показывает контекст, число совпадений, страницы, подсветку и переходы стрелками/Enter/Shift+Enter. Специальные символы запроса трактуются как текст. До 1 500 результатов доступны навигацией, первые 200 показаны в боковом списке; при превышении лимита предлагается уточнить запрос. Это не семантический поиск и не поиск по нераспознанным сканам.

## Данные и ограничения

В PostgreSQL выделена схема `knowledge`: источники, документы с оригинальными байтами, страницы и русский полнотекстовый индекс, реестр, названия составов, связи с инструкциями, упоминания и будущие взаимодействия. Runtime имеет только SELECT в этой схеме. Импорт выполняет отдельный локальный процесс; его секрет не передаётся веб-приложению. Загрузчик не подключён к БД и не получает секреты.

2 460 точных текстовых совпадений с 368 названиями реестра сохранены как `unreviewed_mention`. Упоминание не означает рекомендацию к назначению. Перекрёстный поиск второго МНН в инструкции показывается отдельно от DDI. Отсутствие пары всегда даёт `safeToCombine: null`; результат не утверждает совместимость. Сопоставление с DDInter, отдельными компонентами, дозами, суммарными эффектами и факторами пациента не выполнено. Все документы и потенциальные правила остаются без клинического допуска.

При обновлении выгрузки нужны новый снимок, повторная проверка статусов/дат и пересборка очереди. Текущий upsert не является системой отзыва ранее сохранённых версий. Права дальнейшего распространения официальных оригиналов и коммерческая лицензия требуют отдельной проверки.

## Управление локальным сбором

Загрузчик и импорт работают в фоне, пока запущен Docker. Перезапуск продолжает сбор из архива. Команды ниже не обновляют отдельный демостенд и не очищают тома:

```sh
python3 scripts/knowledge/prepare-psychiatry.py --apply
docker compose --profile knowledge-tools up -d knowledge-download knowledge-import
docker compose logs --tail 30 knowledge-download knowledge-import
docker compose --profile knowledge-tools stop knowledge-download knowledge-import
```

Для первоначального получения: `fetch-clinical.py`, `fetch-grls.py`, `prepare-grls.py`, `link-mentions.py`; Python-зависимости pypdf 6.10.0 и openpyxl. `Dockerfile.knowledge` содержит загрузчик инструкций; подготовка XLSX требует openpyxl отдельно. Исходные файлы, промежуточные данные и архив исключены из Docker build context и Git. Для полного повторного импорта используется `server/import-knowledge.mjs`; `--follow` подхватывает новые инструкции раз в 30 секунд.

## Чтение и сверка с оригиналом, 18 октября 2026

Все 33 КР повторно разобраны по расположению букв и ячеек PDF через pdfplumber 0.11.9. Исходные PDF и SHA остаются неизменными. На 3 620 страницах найдено 735 табличных областей; корректные сетки показываются HTML-таблицами с объединёнными ячейками, остальные — оригинальными фрагментами. Найденные нижние примечания и надстрочные знаки сохраняются. Если при сегментации расходится состав букв/цифр, страница отображается оригинальным изображением (139 страниц), рядом доступен текст поиска. Склейка переносов не переписывает клиническое содержание; неоднозначный дефис сохраняется.

Инструкции используют тот же непрерывный просмотр и поиск. Их разметка обрабатывается отдельно только внутри психиатрического отбора. До готовности разметки исходные переносы и колонки текста сохраняются, агрессивное объединение строк не применяется. Скан показывается в исходном виде; OCR не объявляется выполненным.

Есть дополнительный режим исходного PDF на PDF.js 6.4.299 (Mozilla, Apache-2.0). Он загружается отдельно при открытии и даёт поиск с подсветкой, переходы между совпадениями и страницами, масштаб, выделение текста и исходные внутренние ссылки. При наличии PDF-закладок используются они, иначе можно использовать уже извлечённое оглавление. Документ обрабатывается локально, PDF scripting/XFA/eval отключены; внешние ссылки PDF отключены. CSP не ослаблена. Шрифты/CMAP размещены локально. Медицинские документы не попадают в кеш PWA.

Сбор очереди завершился обработкой 1 374 регистраций: 1 147 с документами, 224 без выданных файлов/карточки, 3 ошибки источника (два повреждённых PDF и несовпадение РУ в карточке). В психиатрическом отборе 1 922 файла, общий архив 2 140, включая сохранённую раннюю широкую загрузку. Это снимок; текущие счётчики вычисляются из БД. Полный реестр остаётся доступен отдельным переключателем. По умолчанию показывается психиатрический отбор, готовые инструкции — первыми.

Разметка инструкций выполняется для PDF психиатрического отбора, включая файлы первого пробного импорта без поля mimeType. Исходный PDF может содержать сканы: они показываются без выдуманного распознанного текста. Старые инструкции вне отбора сохранены, повторная массовая загрузка не идёт. Фоновые сбор/импорт остановлены после завершения прохода.

Поле «Формы выпуска» в исходном XLSX в ряде строк содержит только условия отпуска («Без рецепта»). Это исходное значение сохранено для происхождения и не используется в редакторе назначения как нормализованная лекарственная форма. Форму/силу/производителя нужно сверять по оригинальной инструкции конкретного РУ.

Итоговая сверка БД: разметка есть у всех 33 КР и всех 1 922 связанных с психиатрическим отбором PDF-инструкций. Повторный проход обработал также 14 документов раннего импорта без mimeType; всего 1 923 исходных файла в пакете разметки, один не связан с текущим психиатрическим отбором.

### OpenMRS / DDInter import, 18 October 2026
The explicitly requested repository is pinned in `knowledge/openmrs-manifest.json` to commit `7e2bd2c245bd33550ca1b14951d6955767026775`; `kb.json` SHA-256 is `b55f8b147a11a6b394f669f3d007253d595f9016005e42f92a689f249e4f1b2a`. Original files stay outside Git. Preserve repository MPL-2.0/OpenMRS Healthcare Disclaimer and upstream DDInter CC BY-NC-SA 4.0, with attribution copied under `knowledge/licenses/openmrs/`.

Source contains 2,283 drugs, 295,184 direct pair rows, 8,346 disease rows and 111,138 derived rows. Imported 295,183 pairs after quarantining one self-pair (`DDInter225`); 8,268 distinct disease rows after removing 78 exact duplicates. Derived rows are excluded. Mechanisms and disease notes/references remain the source's original English text. Management text is absent in this source and is not generated. Severity `Unknown` remains unknown.

Forty single-INN mappings are backed by exact Russian GRLS INN + original instruction ATC, WHO ATC English identity and exact OpenMRS name/ATC/provider ID. Evidence records retain document checksums and source URLs. This confirms reference identity at active-moiety level only, not clinical approval. Combinations, ambiguous salts, missing mappings and unconfirmed identities remain explicitly unverified. Absence of a pair never establishes safety.

ICD search uses 14,641 active code rows from the NSI OID `1.2.643.5.1.13.13.11.1005`, version 2.27, obtained from the ak4nv/mkb10 mirror; Git blob and content hash are pinned in `knowledge/icd10-manifest.json`. This snapshot is not certified as the latest 2026 release. English code labels come from WHO ICD-10 2019. Drug-disease matching joins exact source labels and the explicit narrow crosswalk in `condition-source-links.json`; descendants show their broader mapped category. Missing mappings are shown as gaps. The ICD catalog contains acute as well as chronic diagnoses; patients explicitly select a confirmed chronic diagnosis.

Colloquial names and abbreviations in `server/condition-search.mjs` affect search only. They do not assign a diagnosis or silently populate a disease interaction mapping. Common adult categories rank above neonatal, congenital and pregnancy-specific results unless the query explicitly requests that group.

Reproduce: run `python3 scripts/knowledge/fetch-reference-catalogs.py`, then `python3 scripts/knowledge/prepare-conditions.py`, then the admin-only offline importer `server/import-reference-catalogs.mjs` through the local `knowledge-import` service. Baseline GRLS/Minzdrav import and migrations must exist first. The runtime has SELECT permissions only on public reference tables.


## Official EAEU naming catalog, 19 October 2026

Catalog [1016](https://nsi.eaeunion.org/portal/1016) provides official Russian/English/Latin INN labels. Page reports last update 26 November 2025. The UI export and internal portal endpoint failed here, but the documented public [API v1](https://nsi.eaeunion.org/portal/info/api) succeeded. `scripts/knowledge/fetch-eaeu-inn.py` reads `/api/v1/dictionaries/1016/elements` at fixed `dateActual=2026-10-19`, with <=1,500 records per request. All 9,578 unique codes were obtained; 5 Latin labels are missing in the source and remain null. Original page responses and normalized corpus stay outside Git; URLs, hashes and counts are pinned in `knowledge/eaeu-inn-manifest.json`.

Apply migration 007 and run `server/import-eaeu-inn.mjs` via the offline `knowledge-import` service. Runtime has SELECT only. Exact unique Russian INNs receive English search labels; exact unique English source labels can receive Russian display labels. No composition/provider review is promoted by this import. Verified DDI identity coverage remains 40 INNs; this is separate from 9,578 translated naming records.

A GRLS registration without a downloaded PDF can still use a confirmed substance/provider mapping for DDI lookup. Instruction screening is explicitly unavailable for that check. The synthetic API verification includes an actual no-PDF registry record; no clinical prescription is created from that historical registration.
