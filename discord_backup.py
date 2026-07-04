"""
Discord-based backup for PostgreSQL database.
Dumps the database using psycopg2, compresses it, and uploads to a Discord channel.
No external tools needed (no pg_dump).

Requires:
  - DATABASE_URL: PostgreSQL connection string
  - BACKUP_CHANNEL_ID: Discord channel ID for backups
"""
import os
import io
import gzip
import json
import logging
import tempfile
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone

logger = logging.getLogger("discord_backup")


def _get_conn():
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        return None
    try:
        conn = psycopg2.connect(url, connect_timeout=30, sslmode="require")
        return conn
    except Exception as e:
        logger.error(f"[Backup] Ошибка подключения: {e}")
        return None


def _dump_table(cur, table_name: str) -> str:
    cur.execute(f'SELECT * FROM "{table_name}"')
    rows = cur.fetchall()
    if not rows:
        return ""
    cols = [desc[0] for desc in cur.description]
    lines = []
    for row in rows:
        vals = []
        for v in row:
            if v is None:
                vals.append("NULL")
            elif isinstance(v, bool):
                vals.append("TRUE" if v else "FALSE")
            elif isinstance(v, (int, float)):
                vals.append(str(v))
            elif isinstance(v, (dict, list)):
                escaped = json.dumps(v, ensure_ascii=False).replace("'", "''")
                vals.append(f"'{escaped}'::jsonb")
            else:
                escaped = str(v).replace("'", "''")
                vals.append(f"'{escaped}'")
        lines.append(f"INSERT INTO \"{table_name}\" ({', '.join(cols)}) VALUES ({', '.join(vals)});")
    return "\n".join(lines)


def create_dump_bytes() -> tuple[bytes, str] | None:
    conn = _get_conn()
    if not conn:
        logger.error("[Backup] Нет подключения к БД")
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

        parts = [f"-- FearSearch Backup {datetime.now(timezone.utc).isoformat()}\n"]
        for table in tables:
            logger.info(f"[Backup] Дамп таблицы: {table}")
            cur.execute(f'SELECT COUNT(*) AS cnt FROM "{table}"')
            cnt = cur.fetchone()['cnt']
            parts.append(f"-- Table: {table} ({cnt} rows)")
            parts.append(f'DROP TABLE IF EXISTS "{table}" CASCADE;')
            parts.append(f'CREATE TABLE "{table}" (LIKE "{table}" INCLUDING ALL);')

            cur.execute(f'SELECT * FROM "{table}"')
            rows = cur.fetchall()
            if rows:
                cols = [desc[0] for desc in cur.description]
                for row in rows:
                    vals = []
                    for v in row:
                        if v is None:
                            vals.append("NULL")
                        elif isinstance(v, bool):
                            vals.append("TRUE" if v else "FALSE")
                        elif isinstance(v, (int, float)):
                            vals.append(str(v))
                        elif isinstance(v, (dict, list)):
                            escaped = json.dumps(v, ensure_ascii=False).replace("\\", "\\\\").replace("'", "''")
                            vals.append(f"'{escaped}'::jsonb")
                        else:
                            escaped = str(v).replace("\\", "\\\\").replace("'", "''")
                            vals.append(f"'{escaped}'")
                    escaped_cols = [f'"{c}"' for c in cols]
                    parts.append(f"INSERT INTO \"{table}\" ({', '.join(escaped_cols)}) VALUES ({', '.join(vals)});")
            parts.append("")

        cur.close()
        sql_text = "\n".join(parts)
        compressed = gzip.compress(sql_text.encode("utf-8"), compresslevel=6)
        now = datetime.now(timezone.utc)
        filename = f"fearsearch_backup_{now.strftime('%Y-%m-%d_%H-%M')}.sql.gz"
        logger.info(f"[Backup] Дамп готов: {len(compressed)} bytes ({len(compressed)/1024/1024:.1f}MB)")
        return compressed, filename
    except Exception as e:
        logger.error(f"[Backup] Ошибка создания дампа: {e}")
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
            f"Размер: {size_mb:.1f}MB",
            file=file
        )
        result["success"] = True
        result["filename"] = filename
        result["message_id"] = msg.id
        result["message"] = f"Бэкап {filename} загружен ({size_mb:.1f}MB)"
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
                if att.filename.startswith("fearsearch_backup_") and att.filename.endswith(".sql.gz"):
                    data = await att.read()
                    logger.info(f"[Backup] Скачан бэкап: {att.filename} ({len(data)} bytes)")
                    return data, att.filename
        logger.warning("[Backup] Бэкапы не найдены в канале")
        return None
    except Exception as e:
        logger.error(f"[Backup] Ошибка скачивания: {e}")
        return None


import discord
