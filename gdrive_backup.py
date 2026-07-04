"""
Google Drive backup for PostgreSQL database.
Uses OAuth2 with your personal Google account (no service account needed).

Setup:
  1. Create OAuth2 Desktop app credentials at https://console.cloud.google.com
  2. Run: python gdrive_backup.py --auth
     → opens browser → login → authorize → get refresh_token
  3. Set in .env:
       GOOGLE_OAUTH_CLIENT_ID=...
       GOOGLE_OAUTH_CLIENT_SECRET=...
       GOOGLE_OAUTH_REFRESH_TOKEN=...
       GOOGLE_DRIVE_FOLDER_ID=...
"""
import os
import sys
import json
import logging
import subprocess
import tempfile
from datetime import datetime, timezone

logger = logging.getLogger("gdrive_backup")

_CREDS = None
_SERVICE = None
_FOLDER_ID = None

REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob"
SCOPES = ["https://www.googleapis.com/auth/drive.file"]
TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"


def _get_folder_id():
    global _FOLDER_ID
    if _FOLDER_ID is None:
        _FOLDER_ID = os.getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip()
    return _FOLDER_ID or None


def _get_creds():
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    refresh_token = os.getenv("GOOGLE_OAUTH_REFRESH_TOKEN", "").strip()
    if not all([client_id, client_secret, refresh_token]):
        return None
    return {"client_id": client_id, "client_secret": client_secret, "refresh_token": refresh_token}


def _get_service():
    global _SERVICE
    if _SERVICE is not None:
        return _SERVICE
    creds = _get_creds()
    if not creds:
        logger.warning("[GDrive] Google OAuth не задан — бэкап отключён")
        return None
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
        oauth_creds = Credentials(
            token=None,
            refresh_token=creds["refresh_token"],
            token_uri=TOKEN_URL,
            client_id=creds["client_id"],
            client_secret=creds["client_secret"],
            scopes=SCOPES,
        )
        oauth_creds.refresh(Request())
        _SERVICE = build("drive", "v3", credentials=oauth_creds)
        logger.info("[GDrive] Google Drive API подключена (OAuth)")
        return _SERVICE
    except Exception as e:
        logger.error(f"[GDrive] Ошибка подключения к Google Drive: {e}")
        _SERVICE = None
        return None


def _run_pg_dump(output_path: str) -> bool:
    db_url = os.getenv("DATABASE_URL", "").strip()
    if not db_url:
        logger.error("[GDrive] DATABASE_URL не задана")
        return False
    try:
        result = subprocess.run(
            ["pg_dump", "--no-owner", "--no-privileges", "-Fc", "-f", output_path, db_url],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode != 0:
            logger.error(f"[GDrive] pg_dump ошибка: {result.stderr}")
            return False
        logger.info(f"[GDrive] pg_dump выполнен: {output_path}")
        return True
    except FileNotFoundError:
        logger.error("[GDrive] pg_dump не найден — установите postgresql-client")
        return False
    except subprocess.TimeoutExpired:
        logger.error("[GDrive] pg_dump таймаут (300с)")
        return False
    except Exception as e:
        logger.error(f"[GDrive] pg_dump ошибка: {e}")
        return False


def _upload_to_gdrive(local_path: str, filename: str) -> dict | None:
    service = _get_service()
    if not service:
        return None
    folder_id = _get_folder_id()
    file_size = os.path.getsize(local_path)
    file_metadata = {"name": filename}
    if folder_id:
        file_metadata["parents"] = [folder_id]
    try:
        from googleapiclient.http import MediaFileUpload
        media = MediaFileUpload(local_path, resumable=(file_size > 5 * 1024 * 1024))
        created = service.files().create(
            body=file_metadata,
            media_body=media,
            fields="id,name,size,createdTime"
        ).execute()
        logger.info(f"[GDrive] Файл загружен: {created.get('name')} (id={created.get('id')})")
        return created
    except Exception as e:
        logger.error(f"[GDrive] Ошибка загрузки: {e}")
        return None


def _cleanup_old_backups(service, folder_id: str, keep_count: int = 7):
    try:
        query = f"'{folder_id}' in parents and name contains 'fearsearch_backup_' and mimeType != 'application/vnd.google-apps.folder'"
        results = service.files().list(
            q=query, fields="files(id,name,createdTime)", orderBy="createdTime desc", pageSize=100
        ).execute()
        files = results.get("files", [])
        if len(files) <= keep_count:
            return
        to_delete = files[keep_count:]
        for f in to_delete:
            service.files().delete(fileId=f["id"]).execute()
            logger.info(f"[GDrive] Удалён старый бэкап: {f.get('name')}")
    except Exception as e:
        logger.warning(f"[GDrive] Ошибка очистки старых бэкапов: {e}")


def create_backup(keep_count: int = 7) -> dict:
    now = datetime.now(timezone.utc)
    filename = f"fearsearch_backup_{now.strftime('%Y-%m-%d_%H-%M')}.dump"
    tmp_dir = tempfile.mkdtemp(prefix="gdrive_bak_")
    local_path = os.path.join(tmp_dir, filename)
    result = {"success": False, "filename": filename, "message": ""}
    try:
        if not _run_pg_dump(local_path):
            result["message"] = "pg_dump failed"
            return result
        file_info = _upload_to_gdrive(local_path, filename)
        if not file_info:
            result["message"] = "Upload to Google Drive failed"
            return result
        service = _get_service()
        folder_id = _get_folder_id()
        if service and folder_id:
            _cleanup_old_backups(service, folder_id, keep_count)
        result["success"] = True
        result["file_id"] = file_info.get("id", "")
        result["message"] = f"Backup {filename} uploaded ({file_info.get('name', '')})"
        logger.info(f"[GDrive] Бэкап завершён: {result['message']}")
        return result
    except Exception as e:
        result["message"] = f"Error: {e}"
        logger.error(f"[GDrive] Бэкап ошибка: {e}")
        return result
    finally:
        try:
            if os.path.exists(local_path):
                os.remove(local_path)
            os.rmdir(tmp_dir)
        except Exception:
            pass


# ── OAuth Auth Flow (запуск локально: python gdrive_backup.py --auth) ──
def run_auth_flow():
    import http.server
    import threading
    import urllib.parse
    import webbrowser

    creds = _get_creds()
    if not creds:
        print("❌ Сначала задай GOOGLE_OAUTH_CLIENT_ID и GOOGLE_OAUTH_CLIENT_SECRET в .env")
        print("   (без GOOGLE_OAUTH_REFRESH_TOKEN — он сейчас будет получен)")
        sys.exit(1)

    client_id = creds["client_id"]
    client_secret = creds["client_secret"]

    auth_params = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
    })
    auth_url = f"{AUTH_URL}?{auth_params}"

    print(f"\n1. Открой в браузере:\n\n   {auth_url}\n")
    print("2. Авторизуйся и скопируй код")
    print("3. Вставь код сюда:\n")

    code = input("   Authorization code: ").strip()
    if not code:
        print("❌ Код не введён")
        sys.exit(1)

    import urllib.request
    data = urllib.parse.urlencode({
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data)
    resp = urllib.request.urlopen(req)
    token_data = json.loads(resp.read())

    refresh_token = token_data.get("refresh_token", "")
    if not refresh_token:
        print("❌ Refresh token не получен")
        sys.exit(1)

    print(f"\n✅ Готово! Добавь в .env:\n")
    print(f"GOOGLE_OAUTH_REFRESH_TOKEN={refresh_token}")
    print()


if __name__ == "__main__":
    if "--auth" in sys.argv:
        run_auth_flow()
    else:
        print("Использование:")
        print("  python gdrive_backup.py --auth   — получить refresh token")
        print("  (бэкап запускается из бота командой /backup)")
