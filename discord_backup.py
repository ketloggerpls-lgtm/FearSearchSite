"""
Discord-based backup for PostgreSQL database.
Dumps all data using psycopg2, compresses, uploads to Discord.
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
from datetime import datetime, timezone

logger = logging.getLogger("discord_backup")


def _get_conn():
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        logger.error("[Backup] DATABASE_URL не задана")
        return None
    try:
        conn = psycopg2.connect(url, connect_timeout=30)
        return conn
    except Exception as e:
        logger.error(f"[Backup] Ошибка подключения: {e}")
        return None


def _dump_table_sql(cur, table_name: str) -> tuple[str, int]:
    """Выгружает одну таблицу в SQL INSERT-ы."""
    try:
        cur.execute(f'SELECT * FROM "{table_name}"')
    except Exception as e:
        logger.warning(f"[Backup] Пропуск таблицы {table_name}: {e}")
        return "", 0

    rows = cur.fetchall()
    if not rows:
        return "", 0

    cols = [desc[0] for desc in cur.description]
    escaped_cols = [f'"{c}"' for c in cols]
    col_list = ", ".join(escaped_cols)

    lines = [f'-- Table: {table_name} ({len(rows)} rows)']
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
                try:
                    s = json.dumps(v, ensure_ascii=False, default=str)
                    s = s.replace("\\", "\\\\").replace("'", "''")
                    vals.append(f"'{s}'::jsonb")
                except Exception:
                    vals.append("NULL")
            elif isinstance(v, bytes):
                import base64
                vals.append(f"'\\x{v.hex()}'::bytea")
            else:
                s = str(v).replace("\\", "\\\\").replace("'", "''")
                vals.append(f"'{s}'")
        lines.append(f'INSERT INTO "{table_name}" ({col_list}) VALUES ({", ".join(vals)});')

    return "\n".join(lines), len(rows)


def create_dump_bytes() -> tuple[bytes, str] | None:
    """Создаёт SQL-дамп всех данных в БД."""
    conn = _get_conn()
    if not conn:
        return None
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Получаем все таблицы
        cur.execute("""
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        """)
        tables = [r['tablename'] for r in cur.fetchall()]
        if not tables:
            logger.error("[Backup] Таблицы не найдены")
            return None

        logger.info(f"[Backup] Найдено {len(tables)} таблиц: {', '.join(tables)}")

        parts = [
            f"-- FearSearch Database Backup",
            f"-- Created: {datetime.now(timezone.utc).isoformat()}",
            f"-- Tables: {len(tables)}",
            "",
            "SET client_encoding = 'UTF8';",
            "",
        ]

        total_rows = 0
        for table in tables:
            sql, rows = _dump_table_sql(cur, table)
            if sql:
                parts.append(sql)
                parts.append("")
                total_rows += rows
                logger.info(f"[Backup] {table}: {rows} строк")

        cur.close()

        sql_text = "\n".join(parts)
        logger.info(f"[Backup] Всего: {total_rows} строк, SQL: {len(sql_text)} bytes")

        compressed = gzip.compress(sql_text.encode("utf-8"), compresslevel=6)
        logger.info(f"[Backup] Сжато: {len(compressed)} bytes ({len(compressed)/1024/1024:.2f}MB)")

        now = datetime.now(timezone.utc)
        filename = f"fearsearch_backup_{now.strftime('%Y-%m-%d_%H-%M')}.sql.gz"
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
                    logger.info(f"[Backup] Скачан: {att.filename} ({len(data)} bytes)")
                    return data, att.filename
        logger.warning("[Backup] Бэкапы не найдены")
        return None
    except Exception as e:
        logger.error(f"[Backup] Ошибка скачивания: {e}")
        return None


import discord
