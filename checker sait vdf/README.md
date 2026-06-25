# VDF Checker — Проверка аккаунтов Steam

Веб-версия чекера `config.vdf` для Fear Project. Использует дизайн и стили с `https://fearsupport-eight.vercel.app/check`.

## Что делает

1. Загружает `config.vdf` из папки Steam (drag & drop или выбор файла, можно несколько файлов).
2. Парсит SteamID64 из `config.vdf` и `loginusers.vdf`.
3. Проверяет каждый аккаунт так же, как бот:
   - Регистрацию и баны на Fear Project (`/profile/{steamid}`)
   - VAC / Game Ban / Community Ban через Steam API
   - Активные баны на Yooma.su
4. Показывает результаты в виде карточек с сортировкой: баны → не на Fear → чистые.
5. **Сохраняет результат проверки в общую историю VDF** (таблицы `vdf_history`, `config_hashes`, `config_accounts`).
6. Есть кнопка «Вернуться на главную» в панель staff.

## Структура

```
checker/
├── backend/
│   ├── app.py              # FastAPI сервер
│   ├── requirements.txt    # Зависимости
│   └── Procfile            # Команда запуска для Railway
└── frontend/
    ├── index.html          # Главная страница
    └── static/
        ├── fearsupport.css # Стили с FearSupport (Tailwind)
        ├── style.css       # Доп. стили: лоадер, карточки, модалка
        └── app.js          # Логика фронтенда
```

## Запуск

### Локально (Python)

```bash
cd backend
pip install -r requirements.txt
# Опционально: создай .env в корне проекта с DATABASE_URL и STEAM_API_KEY
python app.py
```

Открой http://localhost:8080

### Railway / Docker

Развёртывание идёт из папки `backend`. В Railway укажи **Root Directory**: `backend`. Необходимые переменные окружения:

- `DATABASE_URL` — PostgreSQL, общая база с сайтом (обязательно для сохранения истории)
- `STEAM_API_KEY` — ключ Steam Web API
- `FEAR_API_BASE` — базовый URL Fear API (по умолчанию `https://api.fearproject.ru`)
- `PORT` — порт для uvicorn (по умолчанию `8080`)

## API Endpoints

| Endpoint | Method | Описание |
|----------|--------|----------|
| `/api/parse-vdf` | POST | Парсит `.vdf` файлы, возвращает SteamID |
| `/api/check-all` | POST | Проверяет список SteamID (сохраняет в историю) |
| `/api/check-vdf` | POST | Полный flow: parse + check + save в историю |

## Как это работает

Парсинг, проверка Fear / Steam / Yooma и формат результатов взяты из `bot.py`:

- `bot._parse_vdf_steamids()`
- `bot._check_vdf_accounts()`
- `bot._check_yooma_ban()`
- `bot.db_save_vdf_history()` / `db_save_config_accounts()`

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `DATABASE_URL` | PostgreSQL URL для сохранения истории | — |
| `STEAM_API_KEY` | Ключ Steam Web API | — |
| `FEAR_API_BASE` | Базовый URL Fear API | `https://api.fearproject.ru` |
| `PORT` | Порт uvicorn | `8080` |

## Особенности

- CORS разрешён для всех источников (бэкенд проксирует внешние API).
- Steam API батчится по 100 SteamID.
- Семафор ограничивает параллельные запросы к Fear/Yooma.
- Результат записывается в `vdf_history` с `check_id`, `config_hash` и (если есть колонка) `.vdf` контентом в `config_hashes.content`.
- Список SteamID связывается через `config_accounts` для связанных аккаунтов на сайте.
