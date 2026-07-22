const API_BASE = "https://fearproject.ru/api";
const logger = require("./logger");

class FearAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "FearAuthError";
    this.status = status;
  }
}
const REQUEST_TIMEOUT_MS = Number(process.env.FEAR_REQUEST_TIMEOUT_MS || 15000);
const PROFILE_RETRIES = Number(process.env.FEAR_PROFILE_RETRIES || 3);

function buildHeaders() {
  const cookie =
    process.env.FEAR_COOKIE ||
    (process.env.ACCESS_TOKEN
      ? `access_token=${process.env.ACCESS_TOKEN}`
      : null);

  if (!cookie) {
    throw new Error("Set FEAR_COOKIE or ACCESS_TOKEN in environment");
  }

  return {
    accept: "*/*",
    "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "no-cache",
    pragma: "no-cache",
    origin: "https://fearproject.ru",
    referer: "https://fearproject.ru/",
    "user-agent":
      process.env.FEAR_USER_AGENT ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    cookie
  };
}

const MAX_429_RETRIES = Number(process.env.FEAR_429_MAX_RETRIES || 5);
const BASE_DELAY_MS = 1000;

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(path, _attempt = 0) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      headers: buildHeaders(),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) {
    if (_attempt < MAX_429_RETRIES) {
      const retryAfter = response.headers.get("retry-after");
      const waitMs = retryAfter
        ? Math.min(Number(retryAfter) * 1000, 30000)
        : Math.min(BASE_DELAY_MS * Math.pow(2, _attempt), 30000);
      logger.warn("Fear API 429 rate limited, retrying", {
        path,
        attempt: _attempt + 1,
        waitMs,
        durationMs: Date.now() - startedAt
      });
      await sleepMs(waitMs);
      return fetchJson(path, _attempt + 1);
    }
    const body = await response.text();
    logger.error("Fear API 429 exhausted retries", {
      path,
      retries: _attempt,
      durationMs: Date.now() - startedAt,
      body: body.slice(0, 500)
    });
    throw new Error(`Fear API 429 Too Many Requests after ${_attempt} retries: ${body}`);
  }

  const body = await response.text();

  if (response.status === 401 || response.status === 403) {
    logger.error("Fear API auth rejected", {
      path,
      status: response.status,
      durationMs: Date.now() - startedAt,
      body: body.slice(0, 500)
    });
    throw new FearAuthError(
      `Fear API ${response.status} ${response.statusText}: ${body}`,
      response.status
    );
  }

  if (!response.ok) {
    logger.error("Fear API request failed", {
      path,
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - startedAt,
      body: body.slice(0, 500)
    });
    throw new Error(`Fear API ${response.status} ${response.statusText}: ${body}`);
  }

  logger.debug("Fear API request ok", {
    path,
    status: response.status,
    durationMs: Date.now() - startedAt
  });

  try {
    return JSON.parse(body);
  } catch (_error) {
    throw new Error(`Fear API returned non-JSON for ${path}`);
  }
}

async function fetchAdmins() {
  return fetchJson("/admins/");
}

async function fetchProfile(steamid) {
  let attempt = 0;
  let lastError = null;

  while (attempt < PROFILE_RETRIES) {
    attempt += 1;
    try {
      const profile = await fetchJson(`/profile/${steamid}`);
      logger.debug("Profile fetch ok", { steamid, attempt });
      return profile;
    } catch (error) {
      lastError = error;
      if (error instanceof FearAuthError) {
        throw error;
      }
      if (error.message && error.message.includes("429")) {
        const backoffMs = Math.min(2000 * attempt, 15000);
        logger.warn("Profile fetch 429 backoff", {
          steamid,
          attempt,
          backoffMs
        });
        await sleepMs(backoffMs);
        continue;
      }
      logger.warn("Profile fetch retry", {
        steamid,
        attempt,
        maxRetries: PROFILE_RETRIES,
        error: error.message
      });
      if (attempt < PROFILE_RETRIES) {
        await sleepMs(attempt * 1000);
      }
    }
  }

  throw lastError;
}

async function fetchStaffPunishments(steamid, type, page = 1, limit = 100) {
  const path = `/punishments/search?q=${encodeURIComponent(steamid)}&page=${page}&limit=${limit}&type=${type}`;
  return fetchJson(path);
}

const DAVIDONCHIK_BASE = "https://davidonchik.online";

async function fetchStaffPunishmentsFromDavidonchik(steamid, type) {
  const url = `${DAVIDONCHIK_BASE}/admin/${encodeURIComponent(steamid)}?type=${type}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { "accept": "application/json", "user-agent": "FearSearchBot/1.0" },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Davidonchik ${res.status}`);
    const data = await res.json();
    if (data.status !== "ok" || !Array.isArray(data.punishments)) {
      throw new Error("Davidonchik invalid response");
    }
    const rows = data.punishments.map(function(r) {
      return {
        id: r.id,
        steamid: r.steamid,
        name: r.name,
        admin: r.admin,
        admin_steamid: r.admin_steamid,
        admin_avatar: r.admin_avatar || null,
        avatar: r.avatar || null,
        reason: r.reason,
        status: Number(r.status) || 0,
        duration: Number(r.duration) || 0,
        created: Number(r.created) || 0,
        expires: Number(r.expires) || 0,
        unbanPrice: r.unbanPrice || null,
        type: r.type || type
      };
    });
    return { punishments: rows, total: data.total || rows.length };
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  FearAuthError,
  fetchAdmins,
  fetchProfile,
  fetchStaffPunishments,
  fetchStaffPunishmentsFromDavidonchik,
  fetchJson,
  sleep,
  sleepMs
};
