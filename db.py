"""
PostgreSQL-backed persistent storage for FearSearch Bot.
Uses a single table `kv_store` with key→JSONB mapping.
Falls back gracefully if DATABASE_URL is not set.
"""
import os
import json
import time
import datetime
import logging
import psycopg2
import psycopg2.extras

logger = logging.getLogger("db")

_pool = None


def _get_conn():
    global _pool
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        if not getattr(_get_conn, "_warned_missing", False):
            logger.warning("[DB] DATABASE_URL не задана — бот работает без PostgreSQL")
            _get_conn._warned_missing = True
        return None
    if _pool is None or _pool.closed:
        try:
            _pool = psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor, connect_timeout=10)
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
                    source VARCHAR(16) DEFAULT 'bot',
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
            cur.execute("""
                ALTER TABLE vdf_history ADD COLUMN IF NOT EXISTS attachment_url TEXT
            """)
            cur.execute("""
                ALTER TABLE vdf_history ADD COLUMN IF NOT EXISTS message_url TEXT
            """)
            cur.execute("""
                ALTER TABLE vdf_history ADD COLUMN IF NOT EXISTS source VARCHAR(16) DEFAULT 'bot'
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS admins (
                    admin_id BIGINT PRIMARY KEY,
                    steamid TEXT NOT NULL UNIQUE,
                    group_id INTEGER,
                    group_display_name TEXT,
                    group_name TEXT,
                    immunity INTEGER,
                    is_frozen BOOLEAN DEFAULT FALSE,
                    avatar_full TEXT,
                    raw_json JSONB,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS profiles (
                    steamid TEXT PRIMARY KEY,
                    name TEXT,
                    last_activity TIMESTAMPTZ,
                    avatar_full TEXT,
                    discord_nickname TEXT,
                    discord_id TEXT,
                    rank INTEGER,
                    kills INTEGER,
                    deaths INTEGER,
                    playtime INTEGER,
                    ban_is_banned BOOLEAN,
                    vip_is_vip BOOLEAN,
                    faceit_level INTEGER,
                    faceit_elo INTEGER,
                    report_count INTEGER DEFAULT 0,
                    raw_json JSONB,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                ALTER TABLE profiles ADD COLUMN IF NOT EXISTS faceit_level INTEGER
            """)
            cur.execute("""
                ALTER TABLE profiles ADD COLUMN IF NOT EXISTS faceit_elo INTEGER
            """)
            cur.execute("""
                ALTER TABLE profiles ADD COLUMN IF NOT EXISTS report_count INTEGER DEFAULT 0
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS reports (
                    id BIGINT PRIMARY KEY,
                    steamid TEXT NOT NULL,
                    intruder_name TEXT,
                    intruder_avatar TEXT,
                    sender TEXT,
                    sender_steamid TEXT,
                    reason TEXT,
                    created_at TIMESTAMPTZ,
                    raw_json JSONB,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_reports_steamid ON reports(steamid)
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS punishments (
                    id BIGINT PRIMARY KEY,
                    type SMALLINT NOT NULL CHECK (type IN (1, 2)),
                    steamid TEXT NOT NULL,
                    name TEXT,
                    admin TEXT,
                    admin_steamid TEXT,
                    admin_avatar TEXT,
                    avatar TEXT,
                    reason TEXT,
                    status INTEGER,
                    duration INTEGER,
                    created BIGINT,
                    expires BIGINT,
                    unban_price INTEGER,
                    raw_json JSONB,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_punishments_type_created ON punishments(type, created DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_punishments_steamid ON punishments(steamid)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_punishments_admin_steamid ON punishments(admin_steamid)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS panel_server_activity (
                    id SERIAL PRIMARY KEY,
                    timestamp BIGINT NOT NULL,
                    hour INTEGER NOT NULL,
                    total_players INTEGER NOT NULL,
                    total_admins INTEGER NOT NULL,
                    server_data TEXT NOT NULL
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_panel_server_activity_ts ON panel_server_activity(timestamp)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS drops (
                    id SERIAL PRIMARY KEY,
                    drop_id BIGINT UNIQUE NOT NULL,
                    steamid TEXT,
                    name TEXT,
                    price NUMERIC DEFAULT 0,
                    image TEXT,
                    rarity_color TEXT,
                    server_id TEXT,
                    server_name TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    created_at_ts BIGINT,
                    raw_json JSONB,
                    UNIQUE(drop_id, steamid)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_drops_created_at ON drops(created_at)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_drops_steamid ON drops(steamid)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS vdf_rechecks (
                    id SERIAL PRIMARY KEY,
                    check_id INTEGER NOT NULL,
                    steamids TEXT[] NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'pending',
                    results JSONB,
                    requested_by VARCHAR(128) DEFAULT 'site',
                    requested_at TIMESTAMPTZ DEFAULT NOW(),
                    started_at TIMESTAMPTZ,
                    completed_at TIMESTAMPTZ,
                    error TEXT
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_vdf_rechecks_status ON vdf_rechecks(status)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_vdf_rechecks_check_id ON vdf_rechecks(check_id)")
            logger.info("[DB] Таблицы инициализированы")
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


def db_save_config_accounts(config_hash: str, steamids: list[str], filename: str = "", content: str = "") -> bool:
    """Сохранить связь конфига (по хэшу) со списком SteamID и опционально содержимым файла."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            if content:
                cur.execute("""
                    INSERT INTO config_hashes (config_hash, filename, content, created_at)
                    VALUES (%s, %s, %s, NOW())
                    ON CONFLICT (config_hash) DO UPDATE
                    SET filename = EXCLUDED.filename, content = EXCLUDED.content
                """, (config_hash, filename, content))
            else:
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


def db_save_vdf_history(results: list[dict], config_hash: str = "", filename: str = "", check_id: int = 0,
                        attachment_url: str = "", message_url: str = "", source: str = "bot") -> int:
    """Сохранить результаты VDF проверки в историю (по одному на каждый SteamID).

    Если check_id <= 0, генерирует новый идентификатор из общей последовательности.
    Возвращает использованный check_id (или 0 при ошибке).
    """
    if check_id <= 0:
        next_id = db_get_next_vdf_check_id()
        if next_id > 0:
            logger.warning(f"[DB] Получен check_id=0, сгенерирован новый: {next_id}")
            check_id = next_id
        else:
            logger.error(f"[DB] Отказано в сохранении vdf_history: не удалось получить next check_id")
            return 0
    conn = _get_conn()
    if not conn:
        return 0
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM vdf_history WHERE check_id = %s", (check_id,))
            for r in results:
                cur.execute("""
                    INSERT INTO vdf_history
                        (check_id, source, steamid, nickname, fear_banned, fear_reason, fear_unban_time,
                         vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
                         admin_group, config_hash, filename, attachment_url, message_url, on_fear, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """, (
                    check_id,
                    source,
                    r.get("steamid", ""),
                    r.get("nickname", ""),
                    r.get("fear_banned", False),
                    r.get("fear_reason", ""),
                    r.get("fear_unban", ""),
                    r.get("vac_banned", False),
                    r.get("vac_days", 0),
                    r.get("game_bans", 0),
                    any(
                        p.get("status") == "active"
                        for p in r.get("yooma_data", {}).get("punishments", [])
                    ) if r.get("yooma_data", {}).get("found") else False,
                    _extract_yooma_reason(r.get("yooma_data", {})),
                    r.get("admin_group", ""),
                    config_hash,
                    filename,
                    attachment_url,
                    message_url,
                    r.get("on_fear", False),
                ))
        return check_id
    except Exception as e:
        logger.error(f"[DB] Ошибка сохранения vdf_history: {e}")
        return 0


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


def db_get_next_vdf_check_id() -> int:
    """Получить следующий check_id из общей последовательности (сайт + бот)."""
    conn = _get_conn()
    if not conn:
        logger.warning("[DB] Нет подключения к PostgreSQL — next vdf_check_id: 0")
        return 0
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE SEQUENCE IF NOT EXISTS vdf_check_id_seq
                AS INTEGER
                START WITH 1
                INCREMENT BY 1
                NO CYCLE
            """)
            # Если сайт пока не использует последовательность (например, старый код),
            # а максимальный check_id уже далеко ушёл — подгоняем последовательность.
            cur.execute("SELECT last_value FROM vdf_check_id_seq")
            seq_last = cur.fetchone()[0]
            cur.execute("SELECT COALESCE(MAX(check_id), 0) FROM vdf_history")
            max_id = cur.fetchone()[0]
            logger.warning(f"[DB] vdf_check_id_seq: last_value={seq_last}, max(vdf_history.check_id)={max_id}")
            if max_id >= seq_last:
                new_val = max_id + 1
                cur.execute("SELECT setval('vdf_check_id_seq', %s, false)", (new_val,))
                logger.warning(f"[DB] vdf_check_id_seq подтянута к {new_val}")
            cur.execute("SELECT nextval('vdf_check_id_seq')")
            row = cur.fetchone()
            next_id = row[0] if row else 0
            logger.warning(f"[DB] Следующий vdf_check_id: {next_id}")
            return next_id
    except Exception as e:
        logger.error(f"[DB] Ошибка получения next vdf_check_id: {e}")
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


def db_get_vdf_content_by_check_id(check_id: int) -> tuple[str, str] | None:
    """Получить оригинальное содержимое .vdf файла и его имя по check_id."""
    conn = _get_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT ch.content, ch.filename
                FROM config_hashes ch
                JOIN vdf_history vh ON vh.config_hash = ch.config_hash
                WHERE vh.check_id = %s
                LIMIT 1
            """, (check_id,))
            row = cur.fetchone()
            if not row:
                return None
            content = row["content"] or ""
            filename = row["filename"] or f"check_{check_id}.vdf"
            return (content, filename)
    except Exception as e:
        logger.error(f"[DB] Ошибка получения содержимого VDF по check_id: {e}")
        return None


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


# ── Punishments ──────────────────────────────────────────────────────────────

def db_upsert_punishment(row: dict, ptype: int) -> bool:
    """UPSERT одного наказания. ptype: 1=бан, 2=мут."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        pid = int(row.get("id") or 0)
        if not pid:
            return False
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO punishments (
                    id, type, steamid, name, admin, admin_steamid, admin_avatar, avatar,
                    reason, status, duration, created, expires, unban_price, raw_json, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    type = EXCLUDED.type, steamid = EXCLUDED.steamid, name = EXCLUDED.name,
                    admin = EXCLUDED.admin, admin_steamid = EXCLUDED.admin_steamid,
                    admin_avatar = EXCLUDED.admin_avatar, avatar = EXCLUDED.avatar,
                    reason = EXCLUDED.reason, status = EXCLUDED.status, duration = EXCLUDED.duration,
                    created = EXCLUDED.created, expires = EXCLUDED.expires,
                    unban_price = EXCLUDED.unban_price, raw_json = EXCLUDED.raw_json, updated_at = NOW()
            """, (
                pid, ptype,
                str(row.get("steamid") or row.get("steam_id") or ""),
                row.get("name", ""),
                row.get("admin") or row.get("admin_name") or "",
                str(row.get("admin_steamid") or ""),
                row.get("admin_avatar") or row.get("admin_steam_avatar") or None,
                row.get("avatar") or row.get("player_avatar") or None,
                row.get("reason", ""),
                int(row.get("status") or 0),
                int(row.get("duration") or 0),
                int(row.get("created") or 0),
                int(row.get("expires") or 0),
                row.get("unbanPrice") or row.get("unban_price") or None,
                json.dumps(row, ensure_ascii=False, default=str),
            ))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка upsert_punishment id={row.get('id')}: {e}")
        return False


def db_upsert_punishments_batch(rows: list, ptype: int) -> int:
    """Batch UPSERT наказаний. Возвращает количество записанных."""
    conn = _get_conn()
    if not conn or not rows:
        return 0
    written = 0
    try:
        with conn.cursor() as cur:
            for row in rows:
                pid = int(row.get("id") or 0)
                if not pid:
                    continue
                cur.execute("""
                    INSERT INTO punishments (
                        id, type, steamid, name, admin, admin_steamid, admin_avatar, avatar,
                        reason, status, duration, created, expires, unban_price, raw_json, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        type = EXCLUDED.type, steamid = EXCLUDED.steamid, name = EXCLUDED.name,
                        admin = EXCLUDED.admin, admin_steamid = EXCLUDED.admin_steamid,
                        admin_avatar = EXCLUDED.admin_avatar, avatar = EXCLUDED.avatar,
                        reason = EXCLUDED.reason, status = EXCLUDED.status, duration = EXCLUDED.duration,
                        created = EXCLUDED.created, expires = EXCLUDED.expires,
                        unban_price = EXCLUDED.unban_price, raw_json = EXCLUDED.raw_json, updated_at = NOW()
                """, (
                    pid, ptype,
                    str(row.get("steamid") or row.get("steam_id") or ""),
                    row.get("name", ""),
                    row.get("admin") or row.get("admin_name") or "",
                    str(row.get("admin_steamid") or ""),
                    row.get("admin_avatar") or row.get("admin_steam_avatar") or None,
                    row.get("avatar") or row.get("player_avatar") or None,
                    row.get("reason", ""),
                    int(row.get("status") or 0),
                    int(row.get("duration") or 0),
                    int(row.get("created") or 0),
                    int(row.get("expires") or 0),
                    row.get("unbanPrice") or row.get("unban_price") or None,
                    json.dumps(row, ensure_ascii=False, default=str),
                ))
                written += 1
    except Exception as e:
        logger.error(f"[DB] Ошибка batch upsert punishments: {e}")
    return written


def db_get_punishments_by_admin(admin_steamid: str, ptype: int = 0, limit: int = 100, offset: int = 0) -> list[dict]:
    """Получить наказания конкретного админа."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            if ptype:
                cur.execute("""
                    SELECT id, type, steamid, name, admin, admin_steamid, reason, status,
                           duration, created, expires, unban_price, updated_at
                    FROM punishments WHERE admin_steamid = %s AND type = %s
                    ORDER BY created DESC LIMIT %s OFFSET %s
                """, (admin_steamid, ptype, limit, offset))
            else:
                cur.execute("""
                    SELECT id, type, steamid, name, admin, admin_steamid, reason, status,
                           duration, created, expires, unban_price, updated_at
                    FROM punishments WHERE admin_steamid = %s
                    ORDER BY created DESC LIMIT %s OFFSET %s
                """, (admin_steamid, limit, offset))
            rows = cur.fetchall()
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"[DB] Ошибка get_punishments_by_admin: {e}")
        return []


def db_get_staff_punishment_stats(since: int = 0) -> dict:
    """Агрегация наказаний по стаффу: {steamid: {bans: N, mutes: N}}."""
    conn = _get_conn()
    if not conn:
        return {}
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT admin_steamid, type, COUNT(*)::int as count
                FROM punishments WHERE created >= %s AND admin_steamid != ''
                GROUP BY admin_steamid, type
            """, (since,))
            stats = {}
            for r in cur.fetchall():
                sid = r["admin_steamid"]
                if sid not in stats:
                    stats[sid] = {"bans": 0, "mutes": 0}
                if r["type"] == 1:
                    stats[sid]["bans"] = r["count"]
                elif r["type"] == 2:
                    stats[sid]["mutes"] = r["count"]
            return stats
    except Exception as e:
        logger.error(f"[DB] Ошибка get_staff_punishment_stats: {e}")
        return {}


def db_get_punishments_trend(days: int = 30) -> list[dict]:
    """Тренд наказаний по дням."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    to_timestamp(created)::date as day,
                    COUNT(*) FILTER (WHERE type = 1) as bans,
                    COUNT(*) FILTER (WHERE type = 2) as mutes,
                    COUNT(*) as total
                FROM punishments
                WHERE created >= EXTRACT(EPOCH FROM NOW() - INTERVAL '%s days')
                GROUP BY day ORDER BY day ASC
            """, (days,))
            return [dict(r) for r in cur.fetchall()]
    except Exception as e:
        logger.error(f"[DB] Ошибка get_punishments_trend: {e}")
        return []


def db_get_admin_punishment_counts(admin_steamid: str, since_ts: int = 0, until_ts: int = None, exclude_ticket_reasons: bool = True) -> dict:
    """Считает баны/муты админа за период.
    По умолчанию исключает снятые (status=2) и причины 'напиши тикет в дс' и т.п."""
    conn = _get_conn()
    if not conn:
        return {"bans": 0, "mutes": 0}
    try:
        with conn.cursor() as cur:
            status_filter = "AND status IN (1, 4)" if exclude_ticket_reasons else ""
            reason_filter = """
                AND lower(coalesce(reason, '')) !~* '(напиши.*тикет.*дс|тикет.*дс|ticket.*дс|ticket.*ds|discord|напиши.*дс)'
            """ if exclude_ticket_reasons else ""
            until_filter = "AND created <= %s" if until_ts else ""
            params = [admin_steamid, since_ts]
            if until_ts:
                params.append(until_ts)
            cur.execute(f"""
                SELECT
                    COUNT(*) FILTER (WHERE type = 1) as bans,
                    COUNT(*) FILTER (WHERE type = 2) as mutes
                FROM punishments
                WHERE admin_steamid = %s
                  AND created >= %s
                  {until_filter}
                  {status_filter}
                  {reason_filter}
            """, params)
            row = cur.fetchone()
            return dict(row) if row else {"bans": 0, "mutes": 0}
    except Exception as e:
        logger.error(f"[DB] Ошибка get_admin_punishment_counts: {e}")
        return {"bans": 0, "mutes": 0}


def db_get_top_punish_admins(since_ts: int = 0, until_ts: int = None, limit: int = 3) -> list[dict]:
    """Топ админов по наказаниям (баны + муты) за период. Без снятых и тикет-причин."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            until_filter = "AND created <= %s" if until_ts else ""
            params = [since_ts]
            if until_ts:
                params.append(until_ts)
            params.append(limit)
            cur.execute(f"""
                SELECT admin_steamid,
                       MAX(admin) as admin_name,
                       COUNT(*) FILTER (WHERE type = 1) as bans,
                       COUNT(*) FILTER (WHERE type = 2) as mutes,
                       COUNT(*) as total
                FROM punishments
                WHERE created >= %s
                  {until_filter}
                  AND status IN (1, 4)
                  AND lower(coalesce(reason, '')) !~* '(напиши.*тикет.*дс|тикет.*дс|ticket.*дс|ticket.*ds|discord|напиши.*дс)'
                GROUP BY admin_steamid
                ORDER BY total DESC, bans DESC
                LIMIT %s
            """, params)
            return [dict(r) for r in cur.fetchall()]
    except Exception as e:
        logger.error(f"[DB] Ошибка get_top_punish_admins: {e}")
        return []


def db_get_admin_tickets_month(admin_steamid: str, ym: str) -> int:
    """Количество тикетов админа за месяц (из таблицы panel_staff_tickets)."""
    conn = _get_conn()
    if not conn:
        return 0
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COALESCE(SUM(tickets), 0) as total
                FROM panel_staff_tickets
                WHERE steam_id = %s AND ym = %s
            """, (admin_steamid, ym))
            row = cur.fetchone()
            return int(row["total"]) if row else 0
    except Exception as e:
        logger.error(f"[DB] Ошибка get_admin_tickets_month: {e}")
        return 0


def db_get_top_ticket_admins(ym: str, limit: int = 3) -> list[dict]:
    """Топ админов по тикетам за месяц (из таблицы panel_staff_tickets)."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT steam_id, SUM(tickets) as total
                FROM panel_staff_tickets
                WHERE ym = %s
                GROUP BY steam_id
                ORDER BY total DESC
                LIMIT %s
            """, (ym, limit))
            return [dict(r) for r in cur.fetchall()]
    except Exception as e:
        logger.error(f"[DB] Ошибка get_top_ticket_admins: {e}")
        return []


def db_get_punishments_month_compare() -> dict:
    """Сравнение наказаний текущего и прошлого месяца."""
    conn = _get_conn()
    if not conn:
        return {"current": {"bans": 0, "mutes": 0, "total": 0}, "previous": {"bans": 0, "mutes": 0, "total": 0}}
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE type = 1) as bans,
                    COUNT(*) FILTER (WHERE type = 2) as mutes,
                    COUNT(*) as total
                FROM punishments
                WHERE to_char(to_timestamp(created), 'YYYY-MM') = to_char(NOW(), 'YYYY-MM')
            """)
            curr = dict(cur.fetchone() or {"bans": 0, "mutes": 0, "total": 0})
            cur.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE type = 1) as bans,
                    COUNT(*) FILTER (WHERE type = 2) as mutes,
                    COUNT(*) as total
                FROM punishments
                WHERE to_char(to_timestamp(created), 'YYYY-MM') = to_char(NOW() - INTERVAL '1 month', 'YYYY-MM')
            """)
            prev = dict(cur.fetchone() or {"bans": 0, "mutes": 0, "total": 0})
            return {"current": curr, "previous": prev}
    except Exception as e:
        logger.error(f"[DB] Ошибка get_punishments_month_compare: {e}")
        return {"current": {"bans": 0, "mutes": 0, "total": 0}, "previous": {"bans": 0, "mutes": 0, "total": 0}}


def db_get_punishments_list(ptype: int = 0, limit: int = 50, offset: int = 0) -> list[dict]:
    """Получить список последних наказаний."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            if ptype:
                cur.execute("""
                    SELECT id, type, steamid, name, admin, admin_steamid, reason, status,
                           duration, created, expires, updated_at
                    FROM punishments WHERE type = %s
                    ORDER BY created DESC LIMIT %s OFFSET %s
                """, (ptype, limit, offset))
            else:
                cur.execute("""
                    SELECT id, type, steamid, name, admin, admin_steamid, reason, status,
                           duration, created, expires, updated_at
                    FROM punishments
                    ORDER BY created DESC LIMIT %s OFFSET %s
                """, (limit, offset))
            return [dict(r) for r in cur.fetchall()]
    except Exception as e:
        logger.error(f"[DB] Ошибка get_punishments_list: {e}")
        return []


# ── Admins & Profiles ────────────────────────────────────────────────────────

def db_upsert_admin(admin: dict) -> bool:
    """UPSERT админа из Fear API /admins/."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        admin_id = int(admin.get("admin_id") or admin.get("id") or 0)
        steamid = str(admin.get("steamid") or "").strip()
        if not admin_id or not steamid:
            return False
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO admins (
                    admin_id, steamid, group_id, group_display_name, group_name,
                    immunity, is_frozen, avatar_full, raw_json, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (admin_id) DO UPDATE SET
                    steamid = EXCLUDED.steamid, group_id = EXCLUDED.group_id,
                    group_display_name = EXCLUDED.group_display_name,
                    group_name = EXCLUDED.group_name, immunity = EXCLUDED.immunity,
                    is_frozen = EXCLUDED.is_frozen, avatar_full = EXCLUDED.avatar_full,
                    raw_json = EXCLUDED.raw_json, updated_at = NOW()
            """, (
                admin_id, steamid,
                admin.get("group_id"),
                admin.get("group_display_name") or "",
                admin.get("group_name") or "",
                admin.get("immunity") or 0,
                bool(admin.get("is_frozen", False)),
                admin.get("avatar_full") or "",
                json.dumps(admin, ensure_ascii=False, default=str),
            ))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка upsert_admin {steamid}: {e}")
        return False


def db_upsert_profile(profile: dict) -> bool:
    """UPSERT профиля из Fear API /profile/{steamid}."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        steamid = str(profile.get("steamid") or "").strip()
        if not steamid:
            return False
        stats = profile.get("stats") or {}
        ban_info = profile.get("banInfo") or {}
        vip_info = profile.get("vipInfo") or {}
        discord = profile.get("discord") or {}
        faceit = profile.get("faceitLevel") or {}
        discord_nickname = (
            profile.get("discordNickname")
            or profile.get("discord_nickname")
            or discord.get("nickname")
            or discord.get("name")
        )
        discord_id = (
            profile.get("providerUserId")
            or profile.get("provider_user_id")
            or profile.get("discordId")
            or profile.get("discord_id")
            or discord.get("id")
            or discord.get("userId")
        )
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO profiles (
                    steamid, name, last_activity, avatar_full, discord_nickname, discord_id,
                    rank, kills, deaths, playtime, ban_is_banned, vip_is_vip, faceit_level, faceit_elo, raw_json, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (steamid) DO UPDATE SET
                    name = EXCLUDED.name, last_activity = EXCLUDED.last_activity,
                    avatar_full = EXCLUDED.avatar_full, discord_nickname = EXCLUDED.discord_nickname,
                    discord_id = EXCLUDED.discord_id, rank = EXCLUDED.rank,
                    kills = EXCLUDED.kills, deaths = EXCLUDED.deaths, playtime = EXCLUDED.playtime,
                    ban_is_banned = EXCLUDED.ban_is_banned, vip_is_vip = EXCLUDED.vip_is_vip,
                    faceit_level = EXCLUDED.faceit_level, faceit_elo = EXCLUDED.faceit_elo,
                    raw_json = EXCLUDED.raw_json, updated_at = NOW()
            """, (
                steamid,
                profile.get("name") or "",
                profile.get("last_activity") or None,
                profile.get("avatar_full") or profile.get("avatar") or "",
                discord_nickname,
                discord_id,
                stats.get("rank"),
                stats.get("kills"),
                stats.get("deaths"),
                stats.get("playtime"),
                bool(ban_info.get("isBanned", False)),
                bool(vip_info.get("isVip", False)),
                faceit.get("level") if isinstance(faceit, dict) else None,
                faceit.get("elo") if isinstance(faceit, dict) else None,
                json.dumps(profile, ensure_ascii=False, default=str),
            ))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка upsert_profile {steamid}: {e}")
        return False


def db_upsert_reports(reports: list[dict]) -> bool:
    """Сохранить/обновить репорты в БД."""
    conn = _get_conn()
    if not conn or not reports:
        return False
    try:
        with conn.cursor() as cur:
            for r in reports:
                rid = r.get("id")
                if not rid:
                    continue
                intruder = r.get("intruder") or {}
                if isinstance(intruder, str):
                    intruder_name = intruder
                    intruder_steamid = r.get("intruder_steamid") or r.get("steamid") or ""
                    intruder_avatar = r.get("intruder_avatar") or ""
                else:
                    intruder_name = intruder.get("name") or r.get("intruder_name") or ""
                    intruder_steamid = intruder.get("steamid") or r.get("intruder_steamid") or r.get("steamid") or ""
                    intruder_avatar = intruder.get("avatar") or r.get("intruder_avatar") or ""
                sender = r.get("sender") or {}
                if isinstance(sender, str):
                    sender_name = sender
                    sender_steamid = r.get("sender_steamid") or ""
                else:
                    sender_name = sender.get("name") or r.get("sender_name") or ""
                    sender_steamid = sender.get("steamid") or r.get("sender_steamid") or ""
                cur.execute("""
                    INSERT INTO reports (id, steamid, intruder_name, intruder_avatar, sender, sender_steamid, reason, created_at, raw_json, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        steamid = EXCLUDED.steamid,
                        intruder_name = EXCLUDED.intruder_name,
                        intruder_avatar = EXCLUDED.intruder_avatar,
                        sender = EXCLUDED.sender,
                        sender_steamid = EXCLUDED.sender_steamid,
                        reason = EXCLUDED.reason,
                        created_at = EXCLUDED.created_at,
                        raw_json = EXCLUDED.raw_json,
                        updated_at = NOW()
                """, (
                    rid,
                    intruder_steamid,
                    intruder_name,
                    intruder_avatar,
                    sender_name,
                    sender_steamid,
                    r.get("reason") or "",
                    r.get("created_at") or None,
                    json.dumps(r, ensure_ascii=False, default=str),
                ))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка upsert_reports: {e}")
        return False


def db_get_admin_group(steamid: str) -> str:
    """Получить group_name админа по steamid."""
    conn = _get_conn()
    if not conn:
        return ""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT group_name FROM admins WHERE steamid = %s", (steamid,))
            row = cur.fetchone()
            return row["group_name"] if row else ""
    except Exception as e:
        logger.error(f"[DB] Ошибка get_admin_group: {e}")
        return ""


def db_list_admins_with_profiles() -> list[dict]:
    """Получить список админов с профилями."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT a.admin_id, a.steamid, a.group_display_name, a.group_name,
                       a.immunity, a.is_frozen, a.avatar_full,
                       COALESCE(p.name, a.raw_json->>'name') AS name,
                       COALESCE(p.avatar_full, a.avatar_full) AS avatar,
                       p.rank, p.kills, p.deaths, p.playtime,
                       p.discord_nickname, p.discord_id,
                       p.ban_is_banned, p.vip_is_vip,
                       GREATEST(a.updated_at, COALESCE(p.updated_at, a.updated_at)) AS updated_at
                FROM admins a LEFT JOIN profiles p ON p.steamid = a.steamid
                ORDER BY a.admin_id DESC
            """)
            return [dict(r) for r in cur.fetchall()]
    except Exception as e:
        logger.error(f"[DB] Ошибка list_admins_with_profiles: {e}")
        return []


# ── Server Activity ──────────────────────────────────────────────────────────

def db_save_server_activity(total_players: int, total_admins: int, server_data: list) -> bool:
    """Сохранить снапшот активности серверов."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        now = int(time.time())
        hour = datetime.datetime.now().hour
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO panel_server_activity (timestamp, hour, total_players, total_admins, server_data)
                VALUES (%s, %s, %s, %s, %s)
            """, (now, hour, total_players, total_admins, json.dumps(server_data, ensure_ascii=False, default=str)))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка save_server_activity: {e}")
        return False


def db_save_drop(drop: dict) -> bool:
    """Сохранить один дроп в БД."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        created = drop.get("created_at", "")
        created_ts = 0
        if isinstance(created, (int, float)):
            created_ts = int(created)
            if created_ts > 1e12:
                created_dt = datetime.datetime.fromtimestamp(created_ts / 1000, tz=datetime.timezone.utc)
            else:
                created_dt = datetime.datetime.fromtimestamp(created_ts, tz=datetime.timezone.utc)
        elif isinstance(created, str):
            created_dt = _parse_drop_time(created)
            if created_dt:
                created_ts = int(created_dt.timestamp() * 1000)
        else:
            created_dt = datetime.datetime.now(datetime.timezone.utc)
            created_ts = int(created_dt.timestamp() * 1000)

        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO drops (drop_id, steamid, name, price, image, rarity_color, server_id, server_name, created_at, created_at_ts, raw_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (drop_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    price = EXCLUDED.price,
                    image = EXCLUDED.image,
                    rarity_color = EXCLUDED.rarity_color,
                    server_id = EXCLUDED.server_id,
                    server_name = EXCLUDED.server_name,
                    created_at = EXCLUDED.created_at,
                    created_at_ts = EXCLUDED.created_at_ts,
                    raw_json = EXCLUDED.raw_json
            """, (
                drop.get("id"),
                drop.get("steamid"),
                drop.get("name"),
                drop.get("price", 0),
                drop.get("image"),
                drop.get("rarity_color"),
                drop.get("server_id"),
                drop.get("server_name"),
                created_dt,
                created_ts,
                json.dumps(drop, ensure_ascii=False, default=str)
            ))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка save_drop: {e}")
        return False


def _parse_drop_time(s: str):
    """Парсит строку времени дропа."""
    if not s:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%fZ"):
        try:
            return datetime.datetime.strptime(s, fmt).replace(tzinfo=datetime.timezone.utc)
        except ValueError:
            continue
    try:
        ts = int(s)
        if ts > 1e12:
            return datetime.datetime.fromtimestamp(ts / 1000, tz=datetime.timezone.utc)
        return datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc)
    except Exception:
        return None


def db_get_drops(since_ts: int = 0, limit: int = 1000) -> list[dict]:
    """Получить дропы из БД."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT drop_id, steamid, name, price, image, rarity_color, server_id, server_name, created_at, created_at_ts, raw_json
                FROM drops
                WHERE created_at_ts >= %s
                ORDER BY created_at_ts DESC
                LIMIT %s
            """, (since_ts, limit))
            rows = []
            for r in cur.fetchall():
                raw = r["raw_json"] or {}
                rows.append({
                    "id": r["drop_id"],
                    "steamid": r["steamid"],
                    "name": r["name"],
                    "price": float(r["price"]) if r["price"] else 0,
                    "image": r["image"],
                    "rarity_color": r["rarity_color"],
                    "server_id": r["server_id"],
                    "server_name": r["server_name"],
                    "created_at": r["created_at_ts"] or 0,
                    "raw": raw
                })
            return rows
    except Exception as e:
        logger.error(f"[DB] Ошибка get_drops: {e}")
        return []


# ── VDF Rechecks ─────────────────────────────────────────────────────────────

def db_create_recheck(check_id: int, steamids: list[str]) -> int:
    """Создать запрос на перепроверку. Возвращает recheck_id."""
    conn = _get_conn()
    if not conn:
        return 0
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO vdf_rechecks (check_id, steamids, status)
                VALUES (%s, %s, 'pending') RETURNING id
            """, (check_id, steamids))
            row = cur.fetchone()
            return row["id"] if row else 0
    except Exception as e:
        logger.error(f"[DB] Ошибка create_recheck: {e}")
        return 0


def db_get_pending_rechecks() -> list[dict]:
    """Получить ожидающие перепроверки."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, check_id, steamids, status, requested_at
                FROM vdf_rechecks WHERE status = 'pending'
                ORDER BY requested_at ASC LIMIT 10
            """)
            return [dict(r) for r in cur.fetchall()]
    except Exception as e:
        logger.error(f"[DB] Ошибка get_pending_rechecks: {e}")
        return []


def db_update_recheck(recheck_id: int, status: str, results=None, error: str = None) -> bool:
    """Обновить статус перепроверки."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE vdf_rechecks
                SET status = %s,
                    results = %s,
                    error = %s,
                    started_at = CASE WHEN %s = 'processing' THEN NOW() ELSE started_at END,
                    completed_at = CASE WHEN %s IN ('done', 'error') THEN NOW() ELSE completed_at END
                WHERE id = %s
            """, (
                status,
                json.dumps(results, ensure_ascii=False, default=str) if results else None,
                error, status, status, recheck_id,
            ))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка update_recheck: {e}")
        return False


def db_get_recheck_result(recheck_id: int) -> dict:
    """Получить результат перепроверки."""
    conn = _get_conn()
    if not conn:
        return {}
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, check_id, steamids, status, results, error,
                       requested_at, started_at, completed_at
                FROM vdf_rechecks WHERE id = %s
            """, (recheck_id,))
            row = cur.fetchone()
            if not row:
                return {}
            r = dict(row)
            for key in ("requested_at", "started_at", "completed_at"):
                if r.get(key) and hasattr(r[key], "isoformat"):
                    r[key] = r[key].isoformat()
            return r
    except Exception as e:
        logger.error(f"[DB] Ошибка get_recheck_result: {e}")
        return {}


def LogService(service: str, level: str, message: str, data: dict | None = None) -> bool:
    """Записать лог в общую таблицу app_logs."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO app_logs (service, level, message, data, created_at)
                VALUES (%s, %s, %s, %s, NOW())
            """, (service, level, message[:2000], json.dumps(data) if data else None))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка записи лога: {e}")
        return False


# --- Интеграция с панелью (регистрация, сессии, подтверждения) ---

def panel_get_pending_bot_tasks(task_type: str, limit: int = 10) -> list:
    """Получить ожидающие задачи бота из панели."""
    conn = _get_conn()
    if not conn:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, type, payload, status, created_at
                FROM panel_bot_tasks
                WHERE type = %s AND status = 'pending'
                ORDER BY created_at ASC
                LIMIT %s
            """, (task_type, limit))
            rows = cur.fetchall()
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"[DB] Ошибка panel_get_pending_bot_tasks: {e}")
        return []


def panel_update_bot_task(task_id: int, status: str, result: dict | None = None) -> bool:
    """Обновить статус задачи бота."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE panel_bot_tasks
                SET status = %s, result = %s, processed_at = %s
                WHERE id = %s
            """, (status, json.dumps(result) if result else None, int(time.time() * 1000), task_id))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка panel_update_bot_task: {e}")
        return False


def panel_create_registration_confirmation(user_id: int, discord_id: str, confirmation_code: str, expires_at: int) -> int | None:
    """Создать запись о подтверждении регистрации."""
    conn = _get_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO panel_registration_confirmations (user_id, discord_id, confirmation_code, status, expires_at, created_at)
                VALUES (%s, %s, %s, 'pending', %s, %s)
                RETURNING id
            """, (user_id, discord_id, confirmation_code, expires_at, int(time.time() * 1000)))
            row = cur.fetchone()
            return row['id'] if row else None
    except Exception as e:
        logger.error(f"[DB] Ошибка panel_create_registration_confirmation: {e}")
        return None


def panel_get_registration_confirmation(code: str) -> dict | None:
    """Получить подтверждение по коду."""
    conn = _get_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT * FROM panel_registration_confirmations
                WHERE confirmation_code = %s AND status = 'pending' AND expires_at > %s
                LIMIT 1
            """, (code, int(time.time() * 1000)))
            row = cur.fetchone()
            return dict(row) if row else None
    except Exception as e:
        logger.error(f"[DB] Ошибка panel_get_registration_confirmation: {e}")
        return None


def panel_update_registration_confirmation(confirm_id: int, status: str, level: int | None = None) -> bool:
    """Обновить статус подтверждения."""
    conn = _get_conn()
    if not conn:
        return False
    now = int(time.time() * 1000)
    confirmed_at = now if status == 'confirmed' else None
    rejected_at = now if status == 'rejected' else None
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE panel_registration_confirmations
                SET status = %s, level = COALESCE(%s, level), confirmed_at = COALESCE(%s, confirmed_at), rejected_at = COALESCE(%s, rejected_at)
                WHERE id = %s
            """, (status, level, confirmed_at, rejected_at, confirm_id))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка panel_update_registration_confirmation: {e}")
        return False


def panel_update_registration_confirmation_by_code(code: str, discord_id: str | None = None) -> bool:
    """Привязать discord_id к подтверждению по коду."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE panel_registration_confirmations
                SET discord_id = COALESCE(%s, discord_id)
                WHERE confirmation_code = %s AND status = 'pending'
            """, (discord_id, code))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка panel_update_registration_confirmation_by_code: {e}")
        return False


def panel_update_user_status_and_level(user_id: int, status: str, level: int) -> bool:
    """Обновить статус и уровень пользователя панели."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE panel_users
                SET status = %s, level = %s
                WHERE id = %s
            """, (status, level, user_id))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка panel_update_user_status_and_level: {e}")
        return False


def panel_update_user_discord_id(user_id: int, discord_id: str, discord_name: str | None = None) -> bool:
    """Обновить discord_id и discord_name пользователя панели."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            if discord_name:
                cur.execute("""
                    UPDATE panel_users
                    SET discord_id = %s, discord_name = %s
                    WHERE id = %s
                """, (discord_id, discord_name, user_id))
            else:
                cur.execute("""
                    UPDATE panel_users
                    SET discord_id = %s
                    WHERE id = %s
                """, (discord_id, user_id))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка panel_update_user_discord_id: {e}")
        return False


def panel_log_login_event(user_id: int, action: str, details: dict | None = None, ip: str | None = None, user_agent: str | None = None) -> bool:
    """Записать событие входа в панели."""
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO panel_login_logs (user_id, ip_address, user_agent, action, details, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (user_id, ip, user_agent, action, json.dumps(details) if details else None, int(time.time() * 1000)))
        return True
    except Exception as e:
        logger.error(f"[DB] Ошибка panel_log_login_event: {e}")
        return False
