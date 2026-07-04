"""
Discord-based backup for PostgreSQL database.
Dumps all tables as JSON, compresses, uploads to Discord.
No external tools needed.

Requires:
  - DATABASE_URL: PostgreSQL connection string
  - BACKUP_CHANNEL_ID: Discord channel ID for backups
"""
import os
import io
import gzip
import json
import logging
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone, date
from decimal import Decimal

logger = logging.getLogger("discord_backup")


def _get_conn():
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        logger.error("[Backup] DATABASE_URL не задана")
        return None
    try:
        if "sslmode" not in url:
            sep = "&" if "?" in url else "?"
            url += f"{sep}sslmode=require"
        conn = psycopg2.connect(url, connect_timeout=30)
        logger.info(f"[Backup] PostgreSQL подключена")
        return conn
    except Exception as e:
        logger.error(f"[Backup] Ошибка подключения: {e}")
        return None


def _default(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, bytes):
        return obj.hex()
    return str(obj)


def create_dump_bytes() -> tuple[bytes, str] | None:
    conn = _get_conn()
    if not conn:
        return None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute("""
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        """)
        tables = [r['tablename'] for r in cur.fetchall()]
        if not tables:
            logger.error("[Backup] Таблицы не найдены")
            return None

        logger.info(f"[Backup] Таблиц: {len(tables)}")

        # Служебные таблицы бота — пропускаем (восстанавливаются автоматически)
        SKIP_TABLES = {"kv_store", "leaderboard_cache"}

        dump = {
            "created": datetime.now(timezone.utc).isoformat(),
            "tables": {}
        }

        total_rows = 0
        for table in tables:
            if table in SKIP_TABLES:
                logger.info(f"[Backup] {table}: ПРОПУСК (служебная)")
                continue
            cur.execute(f'SELECT * FROM "{table}"')
            rows = cur.fetchall()
            # Convert RealDictRow to plain dicts, strip huge text fields if needed
            clean_rows = []
            for r in rows:
                d = dict(r)
                # Обрезаем content в config_hashes чтобы не раздувать бэкап
                if table == "config_hashes" and "content" in d and d["content"]:
                    d["content"] = d["content"][:100] + "...(truncated)"
                clean_rows.append(d)
            dump["tables"][table] = clean_rows
            total_rows += len(clean_rows)
            logger.info(f"[Backup] {table}: {len(clean_rows)} строк")

        cur.close()

        json_bytes = json.dumps(dump, ensure_ascii=False, default=_default).encode("utf-8")
        logger.info(f"[Backup] JSON: {len(json_bytes)} bytes ({len(json_bytes)/1024/1024:.2f}MB), строк: {total_rows}")

        compressed = gzip.compress(json_bytes, compresslevel=6)
        logger.info(f"[Backup] Сжато: {len(compressed)} bytes ({len(compressed)/1024/1024:.2f}MB)")

        now = datetime.now(timezone.utc)
        filename = f"fearsearch_backup_{now.strftime('%Y-%m-%d_%H-%M')}.json.gz"
        return compressed, filename

    except Exception as e:
        logger.error(f"[Backup] Ошибка: {e}")
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


async def upload_backup(channel) -> dict:
    result = {"success": False, "filename": "", "message": ""}
    dump = create_dump_bytes()
    if not dump:
        result["message"] = "Не удалось создать дамп базы"
        return result
    data, filename = dump
    size_mb = len(data) / (1024 * 1024)
    if len(data) > 25 * 1024 * 1024:
        result["message"] = f"Дамп слишком большой ({size_mb:.1f}MB > 25MB)"
        return result
    try:
        file = discord.File(io.BytesIO(data), filename=filename)
        msg = await channel.send(
            f"☁️ **Бэкап** — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n"
            f"Размер: {size_mb:.2f}MB",
            file=file
        )
        result["success"] = True
        result["filename"] = filename
        result["message_id"] = msg.id
        result["message"] = f"Бэкап {filename} загружен ({size_mb:.2f}MB)"
        logger.info(f"[Backup] {result['message']}")
        return result
    except Exception as e:
        result["message"] = f"Ошибка загрузки: {e}"
        logger.error(f"[Backup] {result['message']}")
        return result


async def download_latest_backup(channel) -> tuple[bytes, str] | None:
    try:
        async for msg in channel.history(limit=50):
            if msg.attachments:
                att = msg.attachments[0]
                if att.filename.startswith("fearsearch_backup_") and att.filename.endswith(".json.gz"):
                    data = await att.read()
                    logger.info(f"[Backup] Скачан: {att.filename} ({len(data)} bytes)")
                    return data, att.filename
        logger.warning("[Backup] Бэкапы не найдены")
        return None
    except Exception as e:
        logger.error(f"[Backup] Ошибка скачивания: {e}")
        return None


import discord
