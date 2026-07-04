"""
Discord-based backup for PostgreSQL database.
Dumps the database, compresses it, and uploads to a Discord channel.
Can also download the latest backup from Discord for restore.

Requires:
  - DATABASE_URL: PostgreSQL connection string
  - BACKUP_CHANNEL_ID: Discord channel ID for backups
"""
import os
import io
import gzip
import logging
import subprocess
import tempfile
from datetime import datetime, timezone

logger = logging.getLogger("discord_backup")


def _get_channel_id():
    return int(os.getenv("BACKUP_CHANNEL_ID", "0") or "0")


def _run_pg_dump(output_path: str) -> bool:
    db_url = os.getenv("DATABASE_URL", "").strip()
    if not db_url:
        logger.error("[Backup] DATABASE_URL не задана")
        return False
    try:
        result = subprocess.run(
            ["pg_dump", "--no-owner", "--no-privileges", "-Fc", "-f", output_path, db_url],
            capture_output=True, text=True, timeout=600
        )
        if result.returncode != 0:
            logger.error(f"[Backup] pg_dump ошибка: {result.stderr}")
            return False
        logger.info(f"[Backup] pg_dump выполнен: {output_path}")
        return True
    except FileNotFoundError:
        logger.error("[Backup] pg_dump не найден — установите postgresql-client")
        return False
    except subprocess.TimeoutExpired:
        logger.error("[Backup] pg_dump таймаут (600с)")
        return False
    except Exception as e:
        logger.error(f"[Backup] pg_dump ошибка: {e}")
        return False


def create_dump_bytes() -> tuple[bytes, str] | None:
    tmp_dir = tempfile.mkdtemp(prefix="discord_bak_")
    dump_path = os.path.join(tmp_dir, "backup.dump")
    gz_path = dump_path + ".gz"
    try:
        if not _run_pg_dump(dump_path):
            return None
        with open(dump_path, "rb") as f_in:
            with gzip.open(gz_path, "wb") as f_out:
                while True:
                    chunk = f_in.read(1024 * 1024)
                    if not chunk:
                        break
                    f_out.write(chunk)
        with open(gz_path, "rb") as f:
            data = f.read()
        now = datetime.now(timezone.utc)
        filename = f"fearsearch_backup_{now.strftime('%Y-%m-%d_%H-%M')}.dump.gz"
        return data, filename
    except Exception as e:
        logger.error(f"[Backup] Ошибка создания дампа: {e}")
        return None
    finally:
        try:
            import os as _os
            for p in [dump_path, gz_path]:
                if _os.path.exists(p):
                    _os.remove(p)
            _os.rmdir(tmp_dir)
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
            f"☁️ **Автобэкап** — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n"
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
                if att.filename.startswith("fearsearch_backup_") and att.filename.endswith(".dump.gz"):
                    data = await att.read()
                    logger.info(f"[Backup] Скачан бэкап: {att.filename} ({len(data)} bytes)")
                    return data, att.filename
        logger.warning("[Backup] Бэкапы не найдены в канале")
        return None
    except Exception as e:
        logger.error(f"[Backup] Ошибка скачивания: {e}")
        return None


import discord
