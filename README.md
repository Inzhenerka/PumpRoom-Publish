# PumpRoom Publish

GitHub Action для загрузки заданий в LMS PumpRoom

Этот экшен упаковывает репозиторий с заданиями в ZIP-архив и загружает его на
платформу PumpRoom.

## Возможности

- Создает ZIP-архив указанного каталога
- Автоматически исключает каталоги `.git` и `.github`
- Позволяет указать дополнительные файлы/каталоги для исключения
- Проверяет репозиторий на типовые ошибки
- Загружает архив в PumpRoom LMS
- Предоставляет подробные сообщения об ошибках в случае неудачной загрузки

## Использование

> ID школы (realm) и API-ключ для публикации заданий вы найдете в разделе
> Интеграция (GitHub) из панели администратора
> [PumpRoom Admin](https://admin.pumproom.tech/).

Чтобы использовать это действие в вашем рабочем процессе, добавьте следующий
шаг:

```yaml
steps:
  - name: Checkout
    uses: actions/checkout@v4

  - name: Upload to PumpRoom
    uses: inzhenerka/pumproom-publish@v1
    with:
      # Обязательно: ID школы из админки
      realm: "your-realm-name"
      # Обязательно: Имя репозитория
      repo_name: ${{ github.event.repository.name }}
      # Обязательно: API-ключ для публикации из админки
      api_key: ${{ secrets.api_key }}
      # Каталог для архивации и загрузки (по умолчанию корень репозитория)
      root_dir: ""
      # Файлы и каталоги для исключения (разделенные запятыми)
      ignore: ".idea,.vscode"
```

### Входные параметры

| Параметр    | Описание                                        | Обязательный | По умолчанию              |
| ----------- | ----------------------------------------------- | ------------ | ------------------------- |
| `realm`     | ID школы из админки                             | Да           |                           |
| `repo_name` | Имя репозитория (без организации GitHub)        | Да           |                           |
| `api_key`   | API-ключ для публикации из админки              | Да           |                           |
| `root_dir`  | Каталог для архивации и загрузки                | Нет          | `''` (корень репозитория) |
| `ignore`    | Файлы и каталоги для исключения (через запятую) | Нет          | `''`                      |

### Пример workflow

```yaml
name: Upload to PumpRoom

on:
  push:
    branches: [main]

jobs:
  upload:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Upload to PumpRoom
        uses: inzhenerka/pumproom-publish@v1
        with:
          realm: "inzh"
          repo_name: ${{ github.event.repository.name }}
          api_key: ${{ secrets.api_key }}
          ignore: ".idea,.vscode"
```

> **Примечание:** Убедитесь, что вы сохранили свой API-ключ как секрет API_KEY в
> настройках вашего репозитория.

## Настройка заданий

Файлы каждого задания должны располагаться в отдельной папке. Имя папки
становится названием задания.

Каждое задание настраивается в едином корневом файле `.pumproom.yml`. Вот его
простейший пример:

```yaml
# yaml-language-server: $schema=https://pumproom-api.inzhenerka-cloud.com/schema/config
pump_room:
  backend: judge0
  language: auto
  visible_name: Демо

  tasks:
    - name: code_task1

    - name: code_task2
      framework: python_multi

    - name: agent_task1
      backend: agent
      framework: helper
```

При работе с файлом IDE автоматически предложит описание полей и
автоподстановку. **Более подробная техническая документация предоставляется по
запросу.**

## Разработка Action

Node.js 24 и Bun 1.4.2. Установка зависимостей:

```sh
bun install --frozen-lockfile
```

| Команда              | Назначение                               |
| -------------------- | ---------------------------------------- |
| `bun run format`     | Форматирование через oxfmt               |
| `bun run check`      | Проверка TypeScript без генерации файлов |
| `bun run lint`       | Проверка через oxlint                    |
| `bun run test`       | Vitest с покрытием                       |
| `bun run test:watch` | Тесты при изменениях                     |
| `bun run build`      | Сборка Node.js Action через esbuild      |
| `bun run prep`       | Форматирование, типы и линтер            |
| `bun run verify`     | Все проверки и сборка                    |

Коммитьте `dist/index.cjs` и карту исходников вместе с изменениями: GitHub запускает
готовый bundle без установки зависимостей. CI проверяет его соответствие исходникам.
Bun используется для разработки; Action выполняется в Node.js 24.

Для локальной отладки скопируйте `.env.example` в `.env` и заполните параметры.
`bun run local-action` запускает реальную синхронизацию — используйте тестовую папку.

## Выпуск Action

Используется release-it, как в SDK и Admin. Изменения сначала нужно закоммитить
в `main`; рабочее дерево должно быть чистым, upstream — настроен.

```sh
bun run release:dry-run  # Просмотр без публикации; не заменяет bun run verify
bun run release         # Версия определяется по Conventional Commits
bun run release:major   # Явный major, например 2.2.0 → 3.0.0
bun run release:minor
bun run release:patch
```

`feat!` и `BREAKING CHANGE` требуют major, `feat` — minor, исправления — patch.
Перед выпуском запускаются проверки и сборка; если `dist` устарел, закоммитьте
пересобранные файлы и повторите запуск.

Release-it меняет версию, создаёт коммит и тег `vX.Y.Z`, отправляет их в GitHub.
Затем `scripts/update-major.js` обновляет ветку `vX` до коммита релизного тега.
Предыдущие major-ветки сохраняются; force-push не используется. npm-пакет и
страница GitHub Release автоматически не публикуются.

Если обновление major-ветки не прошло после отправки тега, устраните причину
и повторите только этот шаг, не создавая ещё один релиз:

```sh
node scripts/update-major.js 3.0.0
```

Потребители подключают `Inzhenerka/PumpRoom-Publish@v3` либо фиксированный
`@v3.0.0`. Смена major в их workflows выполняется явно.

## Source ownership and synchronization

Publish calls `POST /upload/sync_repo` with a complete snapshot and a stable
`source_ref`. New tasks are source-managed. Existing tasks are updated only when
`managed_by=source` and their reference exactly matches. Admin-managed tasks and
other sources are skipped with names and reasons in the report and a workflow
warning. They are never overwritten by sync.

Only missing source-managed tasks with this reference in the target PumpRoom
folder are soft-deleted. A valid empty snapshot deletes that group; never
publish a partial snapshot. Restoring or updating keeps the UID and history.
`force_update=false`; `overwrite`, `delete_missing` and `retain_deleted` are not
sync parameters.

The optional `source_ref` Action input overrides
`${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}`. The generated Git URL has no `.git`
or trailing slash. An explicit reference can be any stable nonempty identifier
and is sent verbatim. Set it when publishing another checkout. When moving a Git
repository, migrate the stored reference or keep the old identifier via this
input.

In Admin, take control to protect manual edits from sync, or duplicate a task.
An explicit import with overwrite remains available for intentional replacement
(such as Tilda).

Deploy with the new API and database migration. Old upload endpoints are
removed. Remove legacy `source: cms/zip` configuration when updating task
repositories; ownership is now maintained by API operations.
