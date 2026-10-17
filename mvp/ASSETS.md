# Графика и визуальный источник

Основной визуальный источник — ../пациент-v7/01-сегодня.png, последний согласованный экран пациента. Старые концепции и оригинальные изображения сохранены без изменений. Вторичные вкладки используют информационную структуру ../концепции-v5/решения-и-промпты.md, адаптированную к серо-зелёной палитре v7.

Графические ресурсы приложения сохранены локально в public/art. Иконки интерфейса — Phosphor Icons (@phosphor-icons/react, MIT); системный шрифт не требует внешней загрузки.

## Сцены

- mood-sage.webp — спокойствие, белый сидящий маскот в серо-зелёных слоях.
- mood-blue.webp — та же сцена, синяя палитра и печальное выражение.
- mood-yellow.webp — та же сцена, жёлтая палитра и улыбка.
- icon-192.png / icon-512.png — PWA-иконки из созданной нейтральной сцены.

## Промпт первого asset

Precise-object-edit / production UI background. Use the approved v7 screenshot as visual authority. Remove all UI, lettering, buttons, navigation, reminders and white lower section. Landscape 1200x1000. Only broad flowing organic sage contours and the exact same seated white matte clay mascot. Mascot on the right, closed curved eyes, tiny smile, cross-legged with hands on knees. Light sage outermost background #E4EEE9 merges into broad bands #D5E5DD #BED5CA #A3C2B2 #83AA97 #668D7C. Left area clear for real UI text. No watermark, frame, text, icons, fog or regular concentric ovals. Actual returned dimensions 1374x1145.

## Промпты состояний

Use the neutral asset as edit target. Preserve size, position, proportions, pose, band geometry and lighting. Blue variant: outer background #E4EDF7, inner #C9DDF0 #B1CBE1 #8FAFCB #7398B7 #547A9B, subtly downcast closed eyes and small downturned mouth, no tears. Yellow variant: outer #F7F0D7, inner #F0E5BB #E5D59B #D8C47F #C9AD60 #AE924B, cheerfully curved closed eyes and small smile. White mascot stays white. No new content or UI.

## Финальная коррекция размещения

Each state is edited separately from its corresponding original. Preserve the entire 1374x1145 image, current palette, expression, pose and organic contours. Scale the whole white character to 88% of its previous size, keep center x1030, move final center up to y660 (approx top455/bottom865). Reconstruct vacated background with its contour color. No added content. This gives breathing room above the real CTA.

## Анимированная сцена редактора v3

Графические ресурсы приложения сохранены локально в public/art.
- public/art/mascot-rig-v2.webp — тот же сидящий персонаж с прозрачным окружением и пустым лицом.
- public/art/face-rig-v2.webp — отдельные реальные raster strokes бровей, закрытых глаз и улыбки на прозрачном фоне. Они разделяются clip-подобластями и плавно трансформируются; вся иллюстрация не заменяется CSS-рисунком.
- public/art/contours-v2.webp — прежний пейзаж без персонажа, сохранён как промежуточный asset.
- public/art/mood-environment-v3.webp — специально созданная портретная среда, а не размытый/увеличенный фрагмент главной.
- public/art/mood-environment-v4.webp — расширенная портретная среда 971×1619 с маленькой плотной нишей и редкими внешними контурами. Используется на главной и в обоих первых экранах редактора; v3 сохранён как промежуточный asset.
- public/art/mood-environment-v5.webp — эксперимент с выраженными тенями и рельефом, не используется: пользователь выбрал прежний неглубокий v4 с улучшенной чёткостью.

Промпты: извлечь персонажа с сохранением позы, пропорций и материала, убрать черты лица, прозрачный фон; создать пять отдельных тёмных закруглённых штрихов (две брови, два закрытых глаза, улыбка) с фиксированной разметкой на прозрачном квадрате. Для портретной среды: 3:4 full-bleed, dense deep sage pocket around virtual mascot at x50%/y51%, five or six broad crisp organic contour bands extending beyond all four edges, light areas behind title and lower controls, no character, text, blur, fog, vignette, frame or visible isolated blob boundary.

Canvas перекрашивает реальное изображение контуров по его яркости. Геометрия и материалы исходного рисунка сохраняются. Семь вручную заданных палитр смешиваются по непрерывной координате 0–6; это не генерация новых контуров средствами рисования. Лицевые штрихи не меняют bitmap при движении, поэтому нет наложения двух разных лиц.

Референс ползунка — присланный пользователем /Users/nikitazdor/Downloads/Summary.png. Заимствована анатомия управления (широкая дорожка без fill, круглый белый thumb, подписи ниже), без замены маскота или переключения приложения на тёмную тему.

Промпт расширения v4: extend the portrait into a 3:5 full-bleed environment, a small dense sage pocket near the upper middle, progressively wider spaced crisp organic contour bands continuing far above, below and to both sides; no character, text, blur, vignette, feather, transparency or fading edges. Исходник: exec-1ffe33b8-c49a-4c61-84e6-5cc0e2d8f86c.png в папке системной генерации этого чата. Фон увеличен на 24% относительно первоначального использования v4, визуальный центр ниши x503/y748; и персонаж, и окружение используют один transform при переходе к словам.

Графические ресурсы приложения сохранены локально в public/art.
