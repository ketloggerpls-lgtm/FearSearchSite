"""
PostgreSQL-backed persistent storage for FearSearch Bot.
Uses a single table `kv_store` with key→JSONB mapping.
Falls back gracefully if DATABASE_URL is not set.
"""
import os
import json
import logging
import psycopg2
import psycopg2.extras

logger = logging.getLogger("db")

_pool = None


def _get_conn():
    global _pool
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        return None
    if _pool is None or _pool.closed:
        try:
            _pool = psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)
            _pool.autocommit = True
            _init_table()
            logger.info("[DB] PostgreSQL подключена")
        except Exception as e:
            logger.error(f"[DB] Ошибка подключения: {e}")
            _pool = None
            return None
    return _pool


def _init_table():
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS kv_store (
                    key TEXT PRIMARY KEY,
                    value JSONB NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS config_hashes (
                    id SERIAL PRIMARY KEY,
                    config_hash VARCHAR(64) UNIQUE NOT NULL,
                    filename TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS config_accounts (
                    id SERIAL PRIMARY KEY,
                    config_hash VARCHAR(64) NOT NULL REFERENCES config_hashes(config_hash) ON DELETE CASCADE,
                    steamid VARCHAR(32) NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(config_hash, steamid)
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_config_accounts_steamid ON config_accounts(steamid)
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS vdf_history (
                    id SERIAL PRIMARY KEY,
                    check_id INTEGER,
                    steamid VARCHAR(32) NOT NULL,
                    nickname TEXT,
                    fear_banned BOOLEAN DEFAULT FALSE,
                    fear_reason TEXT,
                    fear_unban_time TEXT,
                    vac_banned BOOLEAN DEFAULT FALSE,
                    vac_days_ago INTEGER DEFAULT 0,
                    game_bans INTEGER DEFAULT 0,
                    yooma_banned BOOLEAN DEFAULT FALSE,
                    yooma_reason TEXT,
                    admin_group TEXT,
                    config_hash VARCHAR(64),
                    filename TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_vdf_history_steamid ON vdf_history(steamid)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_vdf_history_check_id ON vdf_history(check_id)
            """)
    except Exception as e:
        logger.error(f"[DB] Ошибка создания таблиц: {e}")


def db_load(key: str):
    """Загрузить данные по ключу. Возвращает Python-объект или None."""
    conn = _get_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT value FROM kv_store WHERE key = %s", (key,))
            row = cur.fetchone()
            if row:
                return row["value"]
    except Exception as e:
        logger.error(f"[DB] Ошибка загрузки {key}: {e}")
    return None


def db_save(key: str, data) -> bool:
    """Сохранить данные по ключу. Возвращает True при успехе."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO kv_store (key, value, updated_at)
                VALUES (%s, %s::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            """, (key, json.dumps(data, ensure_ascii=False)))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка сохранения {key}: {e}")
        # Попробовать переподключиться
        global _pool
        _pool = None
        conn2 = _get_conn()
        if conn2:
            try:
                with conn2.cursor() as cur:
                    cur.execute("""
                        INSERT INTO kv_store (key, value, updated_at)
                        VALUES (%s, %s::jsonb, NOW())
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
                    """, (key, json.dumps(data, ensure_ascii=False)))
                return True
            except Exception as e2:
                logger.error(f"[DB] Ошибка сохранения (retry) {key}: {e2}")
    return False


def db_load_all_keys() -> list[str]:
    """Возвращает список всех ключей в хранилище."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT key FROM kv_store ORDER BY key")
            return [row["key"] for row in cur.fetchall()]
    except Exception as e:
        logger.error(f"[DB] Ошибка получения ключей: {e}")
    return []


def db_init() -> bool:
    """Инициализировать подключение. Возвращает True если БД доступна."""
    conn = _get_conn()
    return conn is not None


def db_is_available() -> bool:
    """Проверить доступность БД."""
    return _pool is not None and not _pool.closed


def db_save_config_accounts(config_hash: str, steamids: list[str], filename: str = "") -> bool:
    """Сохранить связь конфига (по хэшу) со списком SteamID."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO config_hashes (config_hash, filename, created_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (config_hash) DO UPDATE SET filename = EXCLUDED.filename
            """, (config_hash, filename))
            for sid in steamids:
                cur.execute("""
                    INSERT INTO config_accounts (config_hash, steamid, created_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (config_hash, steamid) DO NOTHING
                """, (config_hash, sid))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка сохранения config_accounts: {e}")
        return False


def db_get_linked_steamids(steamid: str) -> list[str]:
    """Найти все SteamID, связанные с данным через конфиги."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT ca2.steamid
                FROM config_accounts ca1
                JOIN config_accounts ca2 ON ca1.config_hash = ca2.config_hash
                WHERE ca1.steamid = %s AND ca2.steamid != %s
                ORDER BY ca2.steamid
            """, (steamid, steamid))
            return [row["steamid"] for row in cur.fetchall()]
    except Exception as e:
        logger.error(f"[DB] Ошибка get_linked_steamids: {e}")
        return []


def db_get_all_linked_steamids(steamid: str) -> list[str]:
    """Найти все SteamID включая сам переданный, связанные через конфиги."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT ca2.steamid
                FROM config_accounts ca1
                JOIN config_accounts ca2 ON ca1.config_hash = ca2.config_hash
                WHERE ca1.steamid = %s
                ORDER BY ca2.steamid
            """, (steamid,))
            return [row["steamid"] for row in cur.fetchall()]
    except Exception as e:
        logger.error(f"[DB] Ошибка get_all_linked_steamids: {e}")
        return [steamid]


def db_save_vdf_history(results: list[dict], config_hash: str = "", filename: str = "", check_id: int = 0) -> bool:
    """Сохранить результаты VDF проверки в историю (по одному на каждый SteamID)."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            if check_id > 0:
                cur.execute("DELETE FROM vdf_history WHERE check_id = %s", (check_id,))
            for r in results:
                cur.execute("""
                    INSERT INTO vdf_history
                        (check_id, steamid, nickname, fear_banned, fear_reason, fear_unban_time,
                         vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
                         admin_group, config_hash, filename, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """, (
                    check_id,
                    r.get("steamid", ""),
                    r.get("nickname", ""),
                    r.get("fear_banned", False),
                    r.get("fear_reason", ""),
                    r.get("fear_unban", ""),
                    r.get("vac_banned", False),
                    r.get("vac_days", 0),
                    r.get("game_bans", 0),
                    bool(r.get("yooma_data", {}).get("found", False)),
                    _extract_yooma_reason(r.get("yooma_data", {})),
                    r.get("admin_group", ""),
                    config_hash,
                    filename,
                ))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка сохранения vdf_history: {e}")
        return False


def db_get_max_vdf_check_id() -> int:
    """Получить максимальный check_id из vdf_history."""
    conn = _get_conn()
    if not conn:
        return 0
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COALESCE(MAX(check_id), 0) FROM vdf_history")
            row = cur.fetchone()
            return row[0] if row else 0
    except Exception:
        return 0


def db_get_vdf_history(limit: int = 100) -> list[dict]:
    """Получить историю VDF проверок."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT steamid, nickname, fear_banned, fear_reason, fear_unban_time,
                       vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
                       admin_group, config_hash, filename, check_id, created_at
                FROM vdf_history
                ORDER BY id DESC
                LIMIT %s
            """, (limit,))
            rows = cur.fetchall()
            for r in rows:
                if r.get("created_at"):
                    r["created_at"] = r["created_at"].isoformat() if hasattr(r["created_at"], 'isoformat') else str(r["created_at"])
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"[DB] Ошибка получения vdf_history: {e}")
        return []


def db_get_vdf_history_by_steamid(steamid: str, limit: int = 50) -> list[dict]:
    """Получить историю VDF для конкретного SteamID."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT steamid, nickname, fear_banned, fear_reason, fear_unban_time,
                       vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
                       admin_group, config_hash, filename, check_id, created_at
                FROM vdf_history
                WHERE steamid = %s
                ORDER BY id DESC
                LIMIT %s
            """, (steamid, limit))
            rows = cur.fetchall()
            for r in rows:
                if r.get("created_at"):
                    r["created_at"] = r["created_at"].isoformat() if hasattr(r["created_at"], 'isoformat') else str(r["created_at"])
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"[DB] Ошибка получения vdf_history по steamid: {e}")
        return []


def _extract_yooma_reason(yooma_data: dict) -> str:
    """Извлечь причину бана Yooma из данных."""
    if not yooma_data:
        return ""
    if not yooma_data.get("found"):
        return ""
    punishments = yooma_data.get("punishments", [])
    for p in punishments:
        if p.get("status") == "active":
            return p.get("reason", "") or p.get("type_name", "")
    return ""
