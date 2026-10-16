# e621 extras (EN)

Browser extension and userscript for e621.net and e926.net. The toolkit automates routine cataloging and browsing tasks: syncing downvotes to user blacklists, visualizing post parent-child trees, previewing full media on hover, managing advanced tag scripts with rate-limit protection, and inspecting user edit histories.

### Features

#### Downvotes-to-Blacklist Synchronization
Converts downvoted posts into blacklist rules formatted as `id:N`. In automatic mode, the extension monitors vote clicks and updates your account blacklist directly via the site API. Manual tools allow exporting a clean blacklist backup, fetching downvoted post IDs from your history, appending them to the blacklist, and removing them on demand. Backup creation is disabled while `id:N` rules are active to prevent saving a polluted rule set.

#### Interactive Post Tree Viewer
Traverses parent-child relationships recursively up to the root ancestor and down through all child branches. The viewer opens in a modal window where posts are grouped by generation and linked by smooth vector paths that highlight on hover. The entire tree can be exported as structured JSON or as a standalone SVG file with preview images embedded by the background service worker. The modal can be launched directly from parent/child notices on post pages or via post ID lookup in the extension popup.

#### Media Hover Zoom
Displays enlarged images and videos (WebM, MP4) directly over thumbnails while holding Shift, eliminating the need to open post pages. Allows toggling between sample-grade previews and full-resolution files. A configurable frame-rate limiter reduces cursor tracking overhead on low-end machines. Browser `title` tooltips are temporarily hidden while zoom is active to keep the view unobstructed.

#### Advanced Tag Scripts and Presets
Integrates into the native mode selection box (`mode-box`) across search and pool pages. Offers 9 independent script slots accessible via keyboard keys 1 through 9. Complete slot configurations can be saved, loaded, and deleted as named presets. Active script state is isolated per browser tab using `sessionStorage`, preventing conflicting overwrites across parallel windows.

#### Sticky Keys Mode
Combines multiple tag scripts into a single patch request. When enabled, number keys toggle slots on and off; clicking a post thumbnail applies the combined diff of all selected scripts at once. Pressing Escape deselects all active slots.

#### Tag Script Queue for Hourly Limits
Protects batch-editing workflows against the server limit of 150 edits per hour. If a rate limit (HTTP 429 or edit-related 403) is encountered, edits are redirected to a local queue and slot release times are calculated from `/post_versions.json`. Thumbnails display diagnostic outlines: yellow for queued posts, green for successfully updated posts, and red for locked or deleted items.

#### Queue Management Page (/posts/timeouted)
A dedicated interface accessible at `/posts/timeouted` on supported domains. Renders queued posts with diff previews, metadata, and a countdown timer indicating when the next edit slot becomes available. Includes controls for manual processing and queue clearing. A background service worker tracks timeouts and initiates queue processing once limits expire.

#### Ctrl Preview Tooltip
Renders a floating tooltip near the cursor showing all tag changes staged by the active script or combined sticky slots. Tag names are syntax-highlighted according to site categories (artists, characters, species, meta tags, and commands). Supports both hold-to-view and toggle (Sticky Preview) modes. The tooltip automatically shifts to the opposite side of the cursor when Hover Zoom is active to avoid interface overlap.

#### Specific Post Edits Filter
Embeds a query panel on user profile pages for granular revision tracking. Allows filtering an editor's history by tags present in the post, tags added, or tags removed, with support for standard search operators. Includes an automated counter that tallies matching revisions via the API in real time.

#### Tag Update Statistics
Adds an interactive analytics dashboard to user profiles for inspecting an editor's complete tag contribution history. Fetches and aggregates all post revisions via cursor-based pagination, allowing users to sort tags by most frequently added, most removed, prevalence across updated posts, or recency, complete with native category color coding. Includes live progress tracking, instant tag search, category filters, direct links to filtered revision queries, and CSV export.

#### Additional Interface Options
The popup menu includes toggles to permanently suppress native thumbnail `title` tooltips, display the uploader's name with their rank styling in the post information sidebar, and adjust layout compatibility settings.

### Controls and Shortcuts

Keys 1 through 9 switch the active tag script slot or toggle individual slots in Sticky Keys mode.

Holding Shift over a thumbnail activates Hover Zoom.

Pressing or holding Ctrl displays the tag script diff preview tooltip.

Pressing Escape clears all active selections in Sticky Keys mode and closes open modal dialogs.

### Installation and Development

Download the [latest version of extension](https://github.com/Pikatyu8/e621-extras/releases/tag/v1.5.0), extract to folder.

To load the extension in Chromium-based browsers, open `chrome://extensions`, enable Developer mode, click "Load unpacked", and select the project root directory.



Build and maintenance scripts:

`npm test` runs the unit test suite for the tag script parser.

`npm run lint` validates code quality using ESLint.

`npm run build:userscript` compiles the project into a standalone userscript compatible with Tampermonkey and Violentmonkey.




# e621 extras (RU)

Браузерное расширение и юзерскрипт для сайтов e621.net и e926.net. Набор инструментов предназначен для автоматизации рутинных задач модерации и каталогизации: переноса дизлайков в черный список, интерактивного просмотра деревьев связей постов, масштабирования медиафайлов по наведению курсора, управления тег-скриптами с защитой от часовых лимитов и фильтрации истории правок.

### Возможности

#### Синхронизация дизлайков с черным списком
Инструмент конвертирует дизлайки пользователя в правила черного списка формата `id:N`. В автоматическом режиме расширение перехватывает клики голосования и сразу обновляет черный список в профиле через API. В ручном режиме доступны создание резервной копии чистого черного списка, скачивание идентификаторов отрицательно оцененных постов, их отправка на сервер и последующая очистка. Пока правила `id:N` активны на сайте, создание бэкапа блокируется во избежание засорения резервной копии.

#### Интерактивное дерево связей постов (Post Tree)
Модуль выполняет рекурсивный поиск всей иерархии связанных постов вверх до первоисточника и вниз по всем дочерним веткам. Дерево открывается в модальном окне, где посты упорядочены по поколениям и соединены векторными линиями с подсветкой связей при наведении. Доступен экспорт всей структуры в формате JSON или в виде автономного файла SVG с внедрением растровых превью-изображений через фоновый процесс расширения. Окно просмотра вызывается из интерфейса карточки поста рядом с системными уведомлениями о родителях или через поиск по идентификатору в меню расширения.

#### Увеличение при наведении (Hover Zoom)
Позволяет просматривать изображения и видео (WebM, MP4) в увеличенном размере прямо в галереях при зажатой клавише Shift. Поддерживает быстрое переключение между загрузкой облегченной версии (sample) и оригинала. В настройках можно ограничить частоту обновления координат окна (FPS) для снижения нагрузки на слабые процессоры. На время показа превью нативные браузерные подсказки автоматически деактивируются.

#### Расширенная система тег-скриптов и пресетов
Интегрируется в стандартную панель режимов сайта (`mode-box`). Предоставляет 9 независимых слотов под скрипты с переключением клавишами от 1 до 9. Конфигурации слотов можно сохранять в именованные пресеты. Рабочее состояние скриптов изолировано для каждой вкладки через `sessionStorage`, что предотвращает случайный сброс параметров при одновременной работе в нескольких окнах браузера.

#### Режим Sticky Keys
Позволяет объединять несколько тег-скриптов и отправлять их на сервер за один клик. При активации режима нажатия цифровых клавиш переключают активность отдельных слотов, после чего клик по миниатюре применяет результирующую сумму всех выбранных изменений. Сброс всех выбранных слотов выполняется нажатием клавиши Escape.

#### Очередь тег-скриптов при часовых лимитах
Предотвращает потерю правок при достижении лимита сайта в 150 изменений в час. При фиксации ответа о превышении квоты или ошибках 429 и 403 расширение сохраняет действия в локальную очередь и вычисляет расписание доступности слотов на основе анализа `/post_versions.json`. На миниатюрах отображаются статусные контуры: желтый — пост в очереди, зеленый — обновлен, красный — удален или заблокирован.

#### Страница управления очередью (/posts/timeouted)
Специальный интерфейс, доступный по адресу `/posts/timeouted` на поддерживаемых доменах. Отображает список отложенных постов с детальной информацией, плашкой таймера до освобождения ближайшего слота и кнопками ручного запуска или очистки. Фоновый сервис-воркер автоматически проверяет тайм-ауты и передает команды на отправку очереди, как только лимит исчерпан.

#### Предпросмотр тег-скриптов по клавише Ctrl
Отображает около курсора плавающую подсказку со списком тегов, которые будут изменены активным скриптом или группой закрепленных слотов. Названия подсвечиваются цветами, соответствующими типам тегов на сайте (авторы, виды, персонажи, мета-теги). Доступен как режим удержания Ctrl, так и режим фиксации (Sticky Preview). Положение окна адаптируется при одновременной работе с Hover Zoom во избежание наложения блоков.

#### Фильтр правок в профиле пользователя
Встраивает форму на страницы пользователей для точечной выборки истории изменений. Позволяет фильтровать записи по наличию конкретных тегов в посте, а также по добавленным или удаленным тегам. Содержит функцию подсчета подходящих правок через API без необходимости загружать страницы каталога вручную.

#### Статистика обновлений тегов (Tag Update Statistics)
Добавляет интерактивную панель аналитики на страницы профилей пользователей для детального изучения всей истории правок тегов. Загружает и агрегирует все версии постов редактора через API, позволяя сортировать теги по количеству добавлений, снятий, частоте встречаемости в обновлённых постах или по дате, с сохранением фирменной цветовой подсветки категорий e621. Включает отслеживание прогресса загрузки в реальном времени, мгновенную фильтрацию по имени, прямые ссылки на выборки версий и экспорт данных в CSV.

#### Дополнительные интерфейсные опции
Всплывающее окно расширения содержит переключатели для полного скрытия стандартных браузерных подсказок `title` у миниатюр, отображения имени автора публикации с классом его ранга в блоке информации о посте, а также настройки базовых параметров отображения и совместимости со сторонними скриптами разметки.

### Управление и горячие клавиши

Клавиши от 1 до 9 служат для выбора активного слота скрипта или переключения его состояния в режиме Sticky Keys.

Клавиша Shift при удержании над миниатюрой активирует увеличение медиафайла.

Клавиша Ctrl вызывает всплывающее окно предпросмотра изменений активного тег-скрипта.

Клавиша Escape снимает выбор со всех слотов в режиме Sticky Keys и закрывает окно дерева постов.

### Установка и разработка

Скачайте [последнюю версию расширения](https://github.com/Pikatyu8/e621-extras/releases/tag/v1.5.0), распакуйте в папку.

Для локальной установки в браузерах на базе Chromium необходимо перейти на страницу расширений (`chrome://extensions`), включить режим разработчика и выбрать опцию «Загрузить распакованное расширение», указав корневую папку проекта.

Для проверки кода и запуска тестов используются стандартные сценарии проекта:

`npm test` — запуск набора модульных тестов механизма обработки тегов.

`npm run lint` — проверка кодовой базы линтером ESLint.

`npm run build:userscript` — сборка проекта в единый скрипт для расширений Tampermonkey и Violentmonkey.