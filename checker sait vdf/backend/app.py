from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import httpx
import re
import os
import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import List

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
import io

# Load .env from project root if present (local dev)
BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("checker")

app = FastAPI(title="VDF Checker", version="3.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

STEAM_API_KEY = os.getenv("STEAM_API_KEY", "")
FEAR_API_BASE = os.getenv("FEAR_API_BASE", "https://api.fearproject.ru")
YOOMA_API = "https://yooma.su/api/public/read/punishments"

http_client = httpx.AsyncClient(
    timeout=httpx.Timeout(15.0, connect=5.0),
    limits=httpx.Limits(max_connections=100),
)

# ── PostgreSQL helpers ───────────────────────────────────────────────────────

_db_pool = None


def _get_db():
    global _db_pool
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url:
        return None
    if _db_pool is None or _db_pool.closed:
        try:
            _db_pool = psycopg2.connect(
                url,
                cursor_factory=psycopg2.extras.RealDictCursor,
                connect_timeout=10,
            )
            _db_pool.autocommit = True
            _init_db()
            logger.info("[DB] PostgreSQL connected")
        except Exception as e:
            logger.error(f"[DB] connection error: {e}")
            _db_pool = None
            return None
    return _db_pool


def _init_db():
    conn = _get_db()
    if not conn:
        return
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS config_hashes (
                id SERIAL PRIMARY KEY,
                config_hash VARCHAR(64) UNIQUE NOT NULL,
                filename TEXT,
                content TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            ALTER TABLE config_hashes ADD COLUMN IF NOT EXISTS content TEXT
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
                attachment_url TEXT,
                message_url TEXT,
                on_fear BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            ALTER TABLE vdf_history ADD COLUMN IF NOT EXISTS on_fear BOOLEAN DEFAULT FALSE
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_vdf_history_steamid ON vdf_history(steamid)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_vdf_history_check_id ON vdf_history(check_id)")


def _column_exists(table: str, column: str) -> bool:
    conn = _get_db()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT 1 FROM information_schema.columns
                WHERE table_name = %s AND column_name = %s
            """, (table, column))
            return cur.fetchone() is not None
    except Exception as e:
        logger.error(f"[DB] column_exists error: {e}")
        return False


def _save_vdf_history(results: list[dict], filename: str = "", vdf_text: str = ""):
    """Save results to the shared VDF history. Returns (check_id, success)."""
    conn = _get_db()
    if not conn:
        return None, False
    try:
        steamids = [r["steamid"] for r in results if r.get("steamid")]
        if not steamids:
            return None, False

        if vdf_text:
            config_hash = hashlib.sha256(vdf_text.encode("utf-8", errors="ignore")).hexdigest()[:64]
        else:
            config_hash = hashlib.sha256((",".join(steamids)).encode()).hexdigest()[:64]

        with conn.cursor() as cur:
            cur.execute("SELECT COALESCE(MAX(check_id), 0) AS max_check_id FROM vdf_history")
            row = cur.fetchone()
            check_id = (row["max_check_id"] if row else 0) + 1

            # config_hashes
            if _column_exists("config_hashes", "content") and vdf_text:
                cur.execute("""
                    INSERT INTO config_hashes (config_hash, filename, content, created_at)
                    VALUES (%s, %s, %s, NOW())
                    ON CONFLICT (config_hash) DO UPDATE
                    SET filename = EXCLUDED.filename, content = EXCLUDED.content
                """, (config_hash, filename or "", vdf_text))
            else:
                cur.execute("""
                    INSERT INTO config_hashes (config_hash, filename, created_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (config_hash) DO UPDATE
                    SET filename = EXCLUDED.filename
                """, (config_hash, filename or ""))

            # config_accounts
            for sid in steamids:
                cur.execute("""
                    INSERT INTO config_accounts (config_hash, steamid, created_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (config_hash, steamid) DO NOTHING
                """, (config_hash, sid))

            cur.execute("DELETE FROM vdf_history WHERE check_id = %s", (check_id,))

            for r in results:
                ydata = r.get("yooma_data") or {}
                active_yooma = False
                yooma_reason = ""
                if ydata.get("found") and ydata.get("punishments"):
                    for p in ydata["punishments"]:
                        if p.get("status") == "active":
                            active_yooma = True
                            yooma_reason = p.get("reason") or p.get("type_name") or ""
                            break

                cur.execute("""
                    INSERT INTO vdf_history
                        (check_id, steamid, nickname, fear_banned, fear_reason, fear_unban_time,
                         vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
                         admin_group, config_hash, filename, attachment_url, message_url, on_fear, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
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
                    active_yooma,
                    yooma_reason,
                    r.get("admin_group", ""),
                    config_hash,
                    filename or "",
                    "",
                    "",
                    r.get("on_fear", False),
                ))
        return check_id, True
    except Exception as e:
        logger.error(f"[DB] save_vdf_history error: {e}")
        return None, False


# ── VDF parsing ────────────────────────────────────────────────────────────

def parse_vdf_steamids(text: str) -> List[str]:
    """Extract SteamID64 from config.vdf / loginusers.vdf."""
    found = re.findall(r'"SteamID"\s+"(7656\d{13})"', text)
    if not found:
        found = re.findall(r'"(7656119\d{10})"', text)
    if not found:
        found = re.findall(r'(7656119\d{10})', text)
    return list(dict.fromkeys(found))


# ── Steam / Fear / Yooma checks ────────────────────────────────────────────

async def check_steam_batch(steamids: List[str]) -> dict:
    ids_str = ",".join(steamids[:100])
    params = {"key": STEAM_API_KEY, "steamids": ids_str}
    try:
        bans_task = http_client.get(
            "https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/",
            params=params,
            timeout=httpx.Timeout(15.0, connect=5.0),
        )
        summary_task = http_client.get(
            "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",
            params=params,
            timeout=httpx.Timeout(15.0, connect=5.0),
        )
        bans_res, summary_res = await asyncio.gather(bans_task, summary_task)
    except Exception as e:
        logger.error(f"[Steam] batch error for {len(steamids)} ids: {e}")
        return {"bans": {}, "summaries": {}}

    bans_map = {}
    if bans_res.status_code == 200:
        try:
            for p in bans_res.json().get("players", []):
                sid = p.get("SteamId") or p.get("SteamID") or p.get("steamid") or p.get("steamID")
                if sid:
                    bans_map[str(sid)] = p
        except Exception as e:
            logger.error(f"[Steam] bans parse error: {e}")

    summaries_map = {}
    if summary_res.status_code == 200:
        try:
            for p in summary_res.json().get("response", {}).get("players", []):
                summaries_map[p.get("steamid")] = p
        except Exception as e:
            logger.error(f"[Steam] summary parse error: {e}")

    return {"bans": bans_map, "summaries": summaries_map}


async def check_fear(steamid: str) -> dict | None:
    url = f"{FEAR_API_BASE}/profile/{steamid}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
    }
    try:
        r = await http_client.get(url, headers=headers, timeout=httpx.Timeout(8.0, connect=5.0))
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        logger.debug(f"[Fear] profile error for {steamid}: {e}")
    return None


def _msk_from_timestamp(ts: int) -> str:
    if not ts:
        return "—"
    try:
        dt = datetime.utcfromtimestamp(ts).replace(tzinfo=timezone.utc)
        return dt.strftime("%d.%m.%Y %H:%M")
    except Exception:
        return "—"


async def check_yooma(steamid: str) -> dict:
    params = {"punish_type": 0, "search": steamid, "page": 1, "mobile": 1}
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://yooma.su/ru/punishments",
        "Origin": "https://yooma.su",
    }
    try:
        r = await http_client.get(
            YOOMA_API,
            params=params,
            headers=headers,
            timeout=httpx.Timeout(15.0, connect=5.0),
        )
        if r.status_code != 200:
            return {"found": False, "punishments": []}
        data = r.json()
        if not data or not data.get("ok"):
            return {"found": False, "punishments": []}
        punishments = data.get("punishments", [])
        if not punishments:
            return {"found": False, "punishments": []}

        now_ts = datetime.now(timezone.utc).timestamp()
        processed = []
        for p in punishments:
            if str(p.get("steamid", "")).strip() != str(steamid):
                continue
            created_ts = p.get("created", 0) or 0
            expires_ts = p.get("expires", 0) or 0
            unpunish_id = p.get("unpunish_admin_id")
            if unpunish_id is not None and unpunish_id != 0:
                status = "unbanned"
            elif expires_ts > 0 and expires_ts < now_ts:
                status = "expired"
            else:
                status = "active"
            created_str = _msk_from_timestamp(created_ts)
            expires_str = _msk_from_timestamp(expires_ts) if expires_ts > 0 else "Навсегда"
            if expires_ts <= 0:
                dur_str = "Навсегда"
            else:
                diff = expires_ts - created_ts
                days = diff // 86400
                dur_str = f"{int(days)} дн." if days >= 1 else f"{int(diff // 3600)} ч."
            processed.append({
                "id": p.get("id"),
                "name": p.get("name", "—"),
                "steamid": steamid,
                "reason": p.get("reason", "—"),
                "admin_name": p.get("admin_name", "—"),
                "created": created_str,
                "expires": expires_str,
                "duration": dur_str,
                "status": status,
                "created_ts": created_ts,
                "expires_ts": expires_ts,
                "profile_url": f"https://yooma.su/ru/profile/{steamid}",
            })
        return {"found": len(processed) > 0, "punishments": processed}
    except Exception as e:
        logger.error(f"[Yooma] error for {steamid}: {e}")
        return {"found": False, "punishments": []}


async def check_accounts(steamids: List[str]) -> List[dict]:
    """Check accounts like the bot: Steam + Fear + Yooma."""
    steamids = list(dict.fromkeys(steamids))

    bans_map = {}
    summaries_map = {}
    for i in range(0, len(steamids), 100):
        batch = steamids[i:i + 100]
        res = await check_steam_batch(batch)
        bans_map.update(res.get("bans", {}))
        summaries_map.update(res.get("summaries", {}))

    sem = asyncio.Semaphore(25)

    async def check_one(sid: str) -> dict:
        async with sem:
            fear, yooma = await asyncio.gather(check_fear(sid), check_yooma(sid))
            steam_ban = bans_map.get(sid, {})
            summary = summaries_map.get(sid, {})

            vac_banned = steam_ban.get("VACBanned", False)
            vac_days = steam_ban.get("DaysSinceLastBan", 0)
            game_bans = steam_ban.get("NumberOfGameBans", 0)
            community_ban = steam_ban.get("CommunityBanned", False)
            nickname = summary.get("personaname", sid)
            avatar = summary.get("avatarfull") or summary.get("avatar") or ""

            on_fear = fear is not None
            fear_name = fear.get("name", "") if fear else ""
            ban_info = fear.get("banInfo", {}) if fear else {}
            fear_banned = ban_info.get("isBanned", False)
            fear_reason = ban_info.get("reason", "") if fear_banned else ""
            fear_unban_ts = ban_info.get("unbanTimestamp") if fear_banned else None
            fear_unban = ""
            if fear_unban_ts:
                try:
                    fear_unban = datetime.fromtimestamp(fear_unban_ts).strftime("%d.%m.%Y %H:%M")
                except Exception:
                    pass

            ag = fear.get("adminGroup") if fear else None
            admin_group = ""
            if isinstance(ag, dict):
                admin_group = ag.get("group_name", "")
            if not admin_group or str(admin_group).isdigit():
                admin_group = (fear or {}).get("rank_name", "") if fear else ""
            if not admin_group or str(admin_group).isdigit():
                admin_group = (fear or {}).get("rank", "") if fear else ""

            return {
                "steamid": sid,
                "nickname": fear_name or nickname or sid,
                "avatar": avatar,
                "on_fear": on_fear,
                "fear_banned": fear_banned,
                "fear_reason": fear_reason,
                "fear_unban": fear_unban,
                "fear_unban_ts": fear_unban_ts,
                "vac_banned": vac_banned,
                "vac_days": vac_days,
                "game_bans": game_bans,
                "community_ban": community_ban,
                "yooma_data": yooma,
                "admin_group": admin_group,
            }

    return await asyncio.gather(*[check_one(sid) for sid in steamids])


def to_frontend(r: dict) -> dict:
    """Convert internal result to the camelCase response the frontend expects."""
    yooma_data = r.get("yooma_data") or {}
    active = [p for p in yooma_data.get("punishments", []) if p.get("status") == "active"]
    return {
        "steamid": r.get("steamid", ""),
        "nickname": r.get("nickname", ""),
        "avatar": r.get("avatar", ""),
        "onFear": r.get("on_fear", False),
        "fearBanned": r.get("fear_banned", False),
        "fearReason": r.get("fear_reason", ""),
        "fearUnban": r.get("fear_unban_ts"),  # timestamp for the frontend formatter
        "vacBanned": r.get("vac_banned", False),
        "vacDays": r.get("vac_days", 0),
        "gameBans": r.get("game_bans", 0),
        "communityBan": r.get("community_ban", False),
        "yoomaFound": yooma_data.get("found", False),
        "yoomaBans": [
            {
                "id": p.get("id"),
                "reason": p.get("reason", "—"),
                "admin": p.get("admin_name", "—"),
                "created": p.get("created_ts"),
                "expires": p.get("expires_ts"),
            }
            for p in active
        ],
    }


# ── API endpoints ────────────────────────────────────────────────────────────

@app.post("/api/parse-vdf")
async def parse_vdf(files: List[UploadFile] = File(...)):
    """Compatibility endpoint: parse uploaded .vdf files."""
    all_ids = []
    vdf_text = ""
    for file in files:
        if not file.filename.endswith(".vdf"):
            continue
        content = await file.read()
        text = content.decode("utf-8", errors="ignore")
        if not text.strip():
            text = content.decode("latin-1", errors="ignore")
        ids = parse_vdf_steamids(text)
        all_ids.extend(ids)
        vdf_text += "\n" + text
    unique_ids = list(dict.fromkeys(all_ids))
    return {
        "total_found": len(all_ids),
        "unique_ids": len(unique_ids),
        "steamids": unique_ids,
        "vdf_text": vdf_text,
    }


@app.post("/api/check-all")
async def check_all(request: dict):
    """Compatibility endpoint: check a list of SteamIDs and save the result."""
    steamids = request.get("steamids", [])
    if not steamids:
        raise HTTPException(400, "No steamids provided")
    results = await check_accounts(steamids)
    check_id, saved = _save_vdf_history(results, filename="", vdf_text="")
    return {
        "results": [to_frontend(r) for r in results],
        "total": len(results),
        "check_id": check_id,
        "saved": saved,
    }


@app.post("/api/check-vdf")
async def check_vdf(files: List[UploadFile] = File(...)):
    """Full flow: parse .vdf files, check accounts, and save to VDF history."""
    all_ids = []
    vdf_text = ""
    filename = ""
    for file in files:
        if not file.filename.endswith(".vdf"):
            continue
        if not filename:
            filename = file.filename
        content = await file.read()
        text = content.decode("utf-8", errors="ignore")
        if not text.strip():
            text = content.decode("latin-1", errors="ignore")
        ids = parse_vdf_steamids(text)
        all_ids.extend(ids)
        vdf_text += "\n" + text

    unique_ids = list(dict.fromkeys(all_ids))
    if not unique_ids:
        raise HTTPException(400, "SteamID не найдены в файле")

    results = await check_accounts(unique_ids)
    check_id, saved = _save_vdf_history(results, filename=filename, vdf_text=vdf_text)

    return {
        "results": [to_frontend(r) for r in results],
        "total": len(results),
        "check_id": check_id,
        "saved": saved,
    }


@app.get("/api/download-vdf/{check_id}")
async def download_vdf(check_id: int):
    conn = _get_db()
    if not conn:
        raise HTTPException(500, "База данных недоступна")
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
            if not row or not row.get("content"):
                raise HTTPException(404, "VDF-файл не найден")
        filename = row.get("filename") or f"check_{check_id}.vdf"
        if not filename.lower().endswith(".vdf"):
            filename += ".vdf"
        return StreamingResponse(
            io.BytesIO(row["content"].encode("utf-8")),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Download VDF] ошибка: {e}")
        raise HTTPException(500, "Ошибка при скачивании VDF")


@app.get("/")
async def root():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND_DIR / "static"), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8080)))
