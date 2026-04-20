# API авторизации PC Forge

## Требования

- Node.js 18+
- PostgreSQL (создайте БД: `CREATE DATABASE dipprog;`)

## Установка

```bash
cd backend
npm install
```

## Настройка

Скопируйте `.env.example` в `.env` и укажите свои данные.

### Формат DATABASE_URL

```
postgresql://ИМЯ_ПОЛЬЗОВАТЕЛЯ:ПАРОЛЬ@localhost:5432/dipprog
```

- **ИМЯ_ПОЛЬЗОВАТЕЛЯ** и **ПАРОЛЬ** — те же, что вы вводите в DBeaver при подключении к PostgreSQL (часто пользователь `postgres`).
- Если пароль содержит спецсимволы (`@`, `#`, `:`, `/`, `%` и т.д.), их нужно закодировать в URL (например, `@` → `%40`, `#` → `%23`).
- Порт по умолчанию — `5432`, имя базы — `dipprog`.

**Пример:** если в DBeaver логин `postgres` и пароль `mypass`, строка:
```
DATABASE_URL=postgresql://postgres:mypass@localhost:5432/dipprog
```

Ошибка **28P01** при регистрации означает неверный логин или пароль в `DATABASE_URL` — сверьте с настройками подключения в DBeaver.

## Инициализация БД

```bash
npm run init-db
```

Создаётся таблица `users` (см. `schema.sql`).

## Запуск

```bash
npm start
```

API будет доступен на `http://localhost:3000`.

## Эндпоинты

| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/api/auth/register` | Регистрация (body: `email`, `password`, `name`) |
| POST | `/api/auth/login` | Вход (body: `email`, `password`) |
| GET | `/api/auth/me` | Текущий пользователь (заголовок `Authorization: Bearer <token>`) |

Для эмулятора Android используйте в приложении базовый URL: `http://10.0.2.2:3000`.

---

## Комплектующие, сборки и корзина

После создания таблицы пользователей (`schema.sql`) выполните:

1. **Таблицы для комплектующих и сборок:**
   ```bash
   npm run init-components
   ```
   Создаются таблицы: `component_categories`, `components`, `builds`, `build_components`, `cart_items`. В категориях задаётся **max_per_build** (лимит позиций в сборке: например 1 процессор, 4 ОЗУ). Если таблицы уже были созданы ранее, скрипт применит миграцию и добавит колонку/лимиты.

2. **Наполнение каталога:**
   ```bash
   npm run seed
   ```
   Добавляются категории (процессоры, видеокарты, ОЗУ, материнские платы, накопители, БП, корпуса) и комплектующие с актуальными ценами (руб.).

### Эндпоинты (комплектующие и сборки)

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/categories` | Список категорий |
| GET | `/api/components?category_id=&search=` | Список комплектующих |
| GET | `/api/components/:id` | Один компонент |
| GET | `/api/builds` | Мои сборки (auth) |
| POST | `/api/builds` | Создать сборку (auth) |
| GET | `/api/builds/:id` | Сборка с компонентами (auth) |
| GET | `/api/builds/:id/compatibility` | Проверка совместимости сборки (auth) |
| PUT | `/api/builds/:id` | Переименовать сборку (auth) |
| DELETE | `/api/builds/:id` | Удалить сборку (auth) |
| POST | `/api/builds/:id/components` | Добавить в сборку (auth) |
| DELETE | `/api/builds/:id/components/:component_id` | Удалить из сборки (auth) |
| GET | `/api/cart` | Корзина (auth) |
| POST | `/api/cart` | Добавить в корзину (auth) |
| PUT | `/api/cart/items/:component_id` | Изменить количество (auth) |
| DELETE | `/api/cart/items/:component_id` | Удалить из корзины (auth) |
| POST | `/api/ai/build-suggestions` | Подбор 1–3 сборок по запросу (body: `message`) |
| POST | `/api/builds/from-suggestion` | Создать сборку из подбора ИИ (auth, body: `name`, `component_ids`) |

### ИИ-чат (подбор сборок)

В разделе «ИИ чат» приложения пользователь может написать запрос (например: «Нужна сборка с процессором Ryzen 5 5600 и бюджетом до 400 долларов»). Сервер возвращает 1–3 варианта сборки с описанием, плюсами и минусами; пользователь может нажать «Добавить в мои сборки», и сборка создаётся из выбранного варианта.

**Как работает подбор:** сервер читает каталог из **вашей PostgreSQL** и подставляет его в промпт. Модель не подключается к БД сама — только ваш backend.

**Вариант A — облако (без установки модели на сервер):** задайте в `.env` ключ `OPENAI_API_KEY` (OpenAI, Groq, OpenRouter и любой API с совместимым `/v1/chat/completions`). Модель крутится в интернете; в облако уходит текст с перечнем комплектующих из БД (названия, цены, id). Пример:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
# OPENAI_BASE_URL=https://api.openai.com/v1
```

**Вариант B — локально Ollama** (если `OPENAI_API_KEY` не задан):

1. Установите [Ollama](https://ollama.com) и модель: `ollama run llama3.2`
2. В `.env`: `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, при необходимости `OLLAMA_TRY_MS`.

**Вариант C — без LLM:** если ни облако, ни Ollama не ответили, срабатывает упрощённый подбор по каталогу из БД.

Нейросеть решает: приветствие → текст; запрос сборки → JSON с вариантами. Ключ API **не** вшивайте в Android — только на сервер.
