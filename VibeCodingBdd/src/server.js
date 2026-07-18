require("dotenv").config();

const express = require("express");
const {
  initDb,
  createRefreshRun,
  finalizeRefreshRun,
  upsertAdmin,
  upsertProfile,
  listAdminsWithProfiles,
  listAdminsWithProfilesPaginated,
  listStaffWithServers,
  getProfilesBySteamids,
  getStaffPunishments,
  getStaffPunishmentStats,
  getVdfHistory,
  getVdfHistoryCount,
  getPunishmentLogs,
  getPunishmentLogsCount,
  loginSiteUser,
  getSiteSession,
  deleteSiteSession,
  createSiteUser,
  getStaffStatsForPeriod,
  findAdminByDiscordId,
  getSiteRoleRank,
  MIN_SITE_ROLE_RANK
} = require("./db");
const { FearAuthError, fetchAdmins, fetchProfile, fetchJson } = require("./fearApi");
const logger = require("./logger");
const { notifyAuthFailure, markAuthRecovered } = require("./notify");
const { startStaffPunishmentsSync, syncAllStaffPunishments } = require("./punishmentsSync");

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = "1358108404182159451";
const DISCORD_ROLE_RANK = {
  "1358108404195000576": 15,
  "1474420026022039674": 14,
  "1358118675428937971": 13,
  "1416068024972087366": 12,
  "1358142006131687565": 11,
  "1527002572332732446": 10,
  "1358141957481955556": 9,
  "1358118683142127766": 8,
  "1416073628088401961": 7,
  "1444034036459765894": 7,
  "1444773596185497620": 7,
  "1363567559122751640": 6,
  "1438457934253396088": 6,
};
const DISCORD_ROLE_LABELS = {
  "1358108404195000576": "Владелец",
  "1474420026022039674": "Куратор",
  "1358118675428937971": "Разработчик",
  "1416068024972087366": "Гл. Администратор",
  "1358142006131687565": "Ст. Администратор",
  "1527002572332732446": "Спец. Администратор",
  "1358141957481955556": "Ст. Модератор",
  "1358118683142127766": "Модератор",
  "1416073628088401961": "Мл. Модератор",
  "1444034036459765894": "Модератор Discord",
  "1444773596185497620": "Модератор месяца",
  "1363567559122751640": "Администратор",
  "1438457934253396088": "Администратор +",
};
const MIN_DISCORD_ROLE_RANK = 7;

async function fetchDiscordMemberRoles(discordUserId) {
  if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN not configured");
  const url = `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordUserId}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Discord API ${resp.status}: ${body}`);
  }
  const member = await resp.json();
  return member.roles || [];
}

function resolveDiscordRole(roles) {
  let bestRank = 0;
  let bestRoleId = null;
  for (const roleId of roles) {
    const rank = DISCORD_ROLE_RANK[roleId];
    if (rank && rank > bestRank) {
      bestRank = rank;
      bestRoleId = roleId;
    }
  }
  return bestRoleId ? { rank: bestRank, label: DISCORD_ROLE_LABELS[bestRoleId] } : null;
}
const { handleCheckerApi } = require("./checker");

const PORT = process.env.PORT || 3000;
const PROFILE_CONCURRENCY = Number(process.env.PROFILE_CONCURRENCY || 2);
const PROFILE_DELAY_MS = Number(process.env.PROFILE_DELAY_MS || 800);
const AUTO_REFRESH_MINUTES = Number(process.env.AUTO_REFRESH_MINUTES ?? 30);

const STEAM_API_KEY = process.env.STEAM_API_KEY || '';

const app = express();
app.use(express.json());
app.use(express.static("public"));

const path = require("path");
const publicDir = path.join(__dirname, "..", "public");

app.get("/login", (_req, res) => {
  res.sendFile(path.join(publicDir, "login.html"));
});

app.get("/staff-stats", (_req, res) => {
  res.sendFile(path.join(publicDir, "staff-stats.html"));
});

app.get("/vdf", (_req, res) => {
  res.sendFile(path.join(publicDir, "vdf.html"));
});

app.use((req, _res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(";").forEach(c => {
      const [k, ...v] = c.trim().split("=");
      if (k) req.cookies[k] = decodeURIComponent(v.join("="));
    });
  }
  next();
});

// Checker API: raw body for multipart VDF uploads
app.all("/checker/api/*", (req, res, next) => {
  if (req.method === "POST" && req.headers["content-type"]?.includes("multipart")) {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      req.body = Buffer.concat(chunks);
      handleCheckerApi(req, res, req.originalUrl).catch(err => {
        logger.error("Checker API error", { error: err.message });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: err.message }));
      });
    });
  } else {
    handleCheckerApi(req, res, req.originalUrl).catch(err => {
      logger.error("Checker API error", { error: err.message });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: err.message }));
    });
  }
});
app.use((req, _res, next) => {
  logger.info("HTTP request", {
    method: req.method,
    path: req.path
  });
  next();
});

const STAFF_ROLES = new Set(["admin", "admin+", "staff", "moder", "mlmoder", "stmoder", "stadmin", "gladmin"]);

async function authMiddleware(req, res, next) {
  const path = req.path;
  if (path.startsWith("/checker") || path === "/login" || path === "/api/auth/login" || path === "/api/auth/register" || path === "/api/health") {
    return next();
  }
  const token = req.cookies?.session_token;
  if (!token) {
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
    return res.redirect("/login");
  }
  const session = await getSiteSession(token);
  if (!session) {
    res.clearCookie("session_token");
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Session expired" });
    return res.redirect("/login");
  }
  const rank = getSiteRoleRank(session.role);
  if (rank < MIN_SITE_ROLE_RANK) {
    res.clearCookie("session_token");
    if (req.path.startsWith("/api/")) return res.status(403).json({ error: "Недостаточно прав" });
    return res.redirect("/login");
  }
  req.user = session;
  next();
}

app.use(authMiddleware);

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });
    const result = await loginSiteUser(username, password);
    if (!result) return res.status(401).json({ error: "Invalid credentials" });
    res.cookie("session_token", result.token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax"
    });
    res.json({ ok: true, user: result.user });
  } catch (error) {
    logger.error("Login failed", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password, discord_id } = req.body;
    if (!username || !password || !discord_id) return res.status(400).json({ error: "Логин, пароль и Discord ID обязательны" });
    if (!/^\d{17,20}$/.test(discord_id)) return res.status(400).json({ error: "Некорректный Discord ID" });
    const memberRoles = await fetchDiscordMemberRoles(discord_id);
    if (!memberRoles) return res.status(403).json({ error: "Пользователь не найден в сервере Discord" });
    const resolved = resolveDiscordRole(memberRoles);
    if (!resolved || resolved.rank < MIN_DISCORD_ROLE_RANK) {
      return res.status(403).json({ error: "Недостаточно прав. Доступ только для мл. модератора и выше" });
    }
    const user = await createSiteUser(username, password, null, discord_id, resolved.label);
    res.json({ ok: true, user });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Логин уже занят" });
    logger.error("Register failed", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const token = req.cookies?.session_token;
  if (token) await deleteSiteSession(token);
  res.clearCookie("session_token");
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  res.json({ user: { id: req.user.user_id, username: req.user.username, role: req.user.role, discord_name: req.user.discord_name } });
});

app.get("/api/staff-stats", async (req, res) => {
  try {
    let dateFrom, dateTo;
    if (req.query.from && req.query.to) {
      dateFrom = new Date(req.query.from);
      dateTo = new Date(req.query.to);
      if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
        return res.status(400).json({ error: "Invalid date format" });
      }
    } else {
      const now = new Date();
      dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
      dateTo = now;
    }
    const stats = await getStaffStatsForPeriod(dateFrom, dateTo);

    const ROLE_ORDER = {
      "Стафф": 1, "STAFF": 1,
      "Гл. Администратор": 2, "GLADMIN": 2,
      "Ст. Администратор": 3, "STADMIN": 3, "Ст. Админ": 3,
      "Спец. Администратор": 4, "SPECIAL": 4,
      "Ст. Модератор": 5, "STMODER": 5, "Ст. Модер": 5,
      "Модератор": 6, "MODER": 6,
      "Мл. Модератор": 7, "MLMODER": 7,
      "Владелец": 8, "OWNER": 8,
      "Куратор": 9, "CURATOR": 9,
      "Разработчик": 10, "DEVELOPER": 10,
      "Модератор Discord": 11, "Модератор месяца": 11,
    };
    const EXCLUDED_ROLE_KEYS = new Set(["admin", "admin+", "ADMIN", "ADMIN+", "UNDEFINED"]);
    const EXCLUDED_STEAMIDS = new Set(["76561199077199811"]);

    const staffMap = {};
    for (const row of stats) {
      const sid = row.admin_steamid;
      const roleKey = row.role_key || "STAFF";
      if (EXCLUDED_STEAMIDS.has(sid)) continue;
      if (EXCLUDED_ROLE_KEYS.has(roleKey)) continue;
      if (!staffMap[sid]) {
        staffMap[sid] = {
          steamid: sid,
          name: row.admin,
          role_key: roleKey,
          role: row.role || "Стафф",
          immunity: row.immunity || 0,
          bans: 0,
          mutes: 0,
          removed: 0
        };
      }
      const s = staffMap[sid];
      const isActive = row.status === 1 || row.status === 4;
      const isRemoved = row.status === 2;
      if (row.type === 1) {
        if (isActive) s.bans += row.count;
        if (isRemoved) s.removed += row.count;
      } else if (row.type === 2) {
        if (isActive) s.mutes += row.count;
        if (isRemoved) s.removed += row.count;
      }
    }
    const staffList = Object.values(staffMap)
      .map(s => ({
        ...s,
        total: s.bans + s.mutes,
        role_order: ROLE_ORDER[s.role_key] ?? ROLE_ORDER[s.role] ?? 5,
        role_label: s.role || s.role_key || "Стафф"
      }))
      .sort((a, b) => a.role_order - b.role_order || b.total - a.total);

    const grouped = {};
    for (const s of staffList) {
      const key = s.role_label;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(s);
    }

    res.json({
      staff: staffList,
      grouped,
      period: { from: dateFrom.toISOString(), to: dateTo.toISOString() }
    });
  } catch (error) {
    logger.error("Failed to get staff stats", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

let refreshInProgress = false;
let lastRefreshInfo = null;

async function mapLimit(items, limit, iteratorFn) {
  const result = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      result[currentIndex] = await iteratorFn(items[currentIndex], currentIndex);
    }
  }

  const workers = Array(Math.min(limit, items.length))
    .fill(null)
    .map(() => worker());
  await Promise.all(workers);
  return result;
}

async function refreshAllData() {
  if (refreshInProgress) {
    throw new Error("Refresh is already running");
  }
  refreshInProgress = true;

  const runId = await createRefreshRun();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let adminsTotal = 0;
  let profilesOk = 0;
  let profilesFailed = 0;
  let errorText = null;

  try {
    logger.info("Refresh started", { runId });
    const admins = await fetchAdmins();
    adminsTotal = admins.length;
    logger.info("Admins fetched", { runId, adminsTotal });

    for (const admin of admins) {
      await upsertAdmin(admin);
    }
    logger.info("Admins persisted", { runId, adminsTotal });

    await mapLimit(admins, PROFILE_CONCURRENCY, async (admin) => {
      try {
        const profile = await fetchProfile(admin.steamid);

        if (STEAM_API_KEY && !profile.created_at) {
          try {
            const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${admin.steamid}`;
            const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
            const data = await resp.json();
            const p = data?.response?.players?.[0];
            if (p?.timecreated) {
              profile.created_at = new Date(p.timecreated * 1000).toISOString();
            }
          } catch (_) {}
        }

        await upsertProfile(profile);
        profilesOk += 1;
        logger.debug("Profile synced", { runId, steamid: admin.steamid });
      } catch (error) {
        if (error instanceof FearAuthError) {
          throw error;
        }
        profilesFailed += 1;
        logger.error("Profile sync failed", {
          runId,
          steamid: admin.steamid,
          error: error.message
        });
      }
      if (PROFILE_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, PROFILE_DELAY_MS));
      }
    });

    markAuthRecovered();
  } catch (error) {
    errorText = error.message;
    logger.error("Refresh failed", { runId, error: error.message });

    if (error instanceof FearAuthError) {
      await notifyAuthFailure(error.message);
    } else if (
      typeof error.message === "string" &&
      error.message.includes("Set FEAR_COOKIE")
    ) {
      await notifyAuthFailure(error.message);
    }

    throw error;
  } finally {
    await finalizeRefreshRun(runId, {
      adminsTotal,
      profilesOk,
      profilesFailed,
      errorText
    });

    refreshInProgress = false;
    lastRefreshInfo = {
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      adminsTotal,
      profilesOk,
      profilesFailed,
      errorText
    };

    logger.info("Refresh finished", {
      runId,
      adminsTotal,
      profilesOk,
      profilesFailed,
      errorText,
      durationMs: Date.now() - startedMs
    });
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    refreshInProgress
  });
});

app.get("/api/debug/profile/:steamid", async (req, res) => {
  try {
    const result = await require("./db").pool.query(
      `SELECT steamid, raw_json FROM profiles WHERE steamid = $1`, [req.params.steamid]
    );
    if (result.rows.length === 0) return res.json({ error: "not found" });
    const rj = result.rows[0].raw_json;
    res.json({
      keys: Object.keys(rj),
      created_at: rj.created_at,
      faceitLevel: rj.faceitLevel,
      faceit: rj.faceit,
      stats_keys: rj.stats ? Object.keys(rj.stats) : null,
      stats_created_at: rj.stats?.created_at,
      stats_lastconnect: rj.stats?.lastconnect,
      ban: rj.ban,
      privilege: rj.privilege
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admins", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const search = String(req.query.search || '').trim();
    const sortBy = String(req.query.sortBy || 'admin_id');
    const sortDir = String(req.query.sortDir || 'DESC');
    const { rows, total } = await listStaffWithServers(limit, offset, search, sortBy, sortDir);
    res.json({ rows, total, limit, offset });
  } catch (error) {
    logger.error("Failed to get admins", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/refresh-status", (_req, res) => {
  res.json({
    refreshInProgress,
    lastRefreshInfo
  });
});

app.post("/api/refresh", async (_req, res) => {
  if (refreshInProgress) {
    logger.warn("Refresh rejected: already running");
    return res.status(409).json({ error: "Refresh already running" });
  }

  refreshAllData().catch((error) => {
    logger.error("Background refresh crashed", { error: error.message });
  });
  res.status(202).json({ ok: true, message: "Refresh started" });
});

app.post("/api/punishments-sync", async (_req, res) => {
  syncAllStaffPunishments().catch((error) => {
    logger.error("Background punishments sync crashed", { error: error.message });
  });
  res.status(202).json({ ok: true, message: "Punishments sync started" });
});

app.get("/api/punishments/staff/stats", async (_req, res) => {
  try {
    const admins = await listAdminsWithProfiles();
    const steamids = admins.map((a) => a.steamid).filter(Boolean);
    const stats = await getStaffPunishmentStats(steamids);
    res.json(stats);
  } catch (error) {
    logger.error("Failed to get staff punishment stats", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/punishments/staff/:steamid", async (req, res) => {
  try {
    const { steamid } = req.params;
    const type = Number(req.query.type) || 1;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = await getStaffPunishments(steamid, type, limit);
    res.json(rows);
  } catch (error) {
    logger.error("Failed to get staff punishments", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/punishments/logs", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const search = String(req.query.search || '').trim();
    const [rows, total] = await Promise.all([
      getPunishmentLogs(limit, offset, search),
      getPunishmentLogsCount(search),
    ]);
    res.json({ rows, total, limit, offset });
  } catch (error) {
    logger.error("Failed to get punishment logs", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/servers", async (_req, res) => {
  try {
    const data = await fetchJson("/servers/");
    const servers = Array.isArray(data) ? data : (data.servers || []);
    const adminSteamids = [];
    servers.forEach(s => {
      (s.live_data?.players || []).forEach(p => {
        if (p.steam_id && p.is_admin) adminSteamids.push(p.steam_id);
      });
    });
    const uniqueSteamids = [...new Set(adminSteamids)];
    const profilesMap = await getProfilesBySteamids(uniqueSteamids);
    servers.forEach(s => {
      (s.live_data?.players || []).forEach(p => {
        const prof = profilesMap[p.steam_id];
        if (prof) {
          p.db_name = prof.name;
          p.db_playtime = prof.playtime;
          p.db_kills = prof.kills;
          p.db_deaths = prof.deaths;
          p.db_rank = prof.rank;
          p.db_avatar = prof.avatar_full;
          p.db_fear_created_at = prof.fear_created_at;
          p.db_faceit_level = prof.faceit_level;
          p.db_faceit_elo = prof.faceit_elo;
        }
      });
    });
    res.json({ servers });
  } catch (error) {
    logger.error("Failed to fetch servers", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/vdf-history", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const search = String(req.query.search || '').trim();
    const offset = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      getVdfHistory(limit, offset, search),
      getVdfHistoryCount(search)
    ]);
    res.json({ rows, total, page, limit });
  } catch (error) {
    logger.error("Failed to get VDF history", { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

function startAutoRefresh() {
  if (AUTO_REFRESH_MINUTES <= 0) {
    logger.info("Auto refresh disabled", { AUTO_REFRESH_MINUTES });
    return;
  }

  const intervalMs = AUTO_REFRESH_MINUTES * 60 * 1000;
  setInterval(() => {
    if (refreshInProgress) {
      logger.debug("Auto refresh skipped: refresh already running");
      return;
    }
    refreshAllData().catch((error) => {
      logger.error("Auto refresh failed", { error: error.message });
    });
  }, intervalMs);

  logger.info("Auto refresh scheduled", {
    everyMinutes: AUTO_REFRESH_MINUTES
  });
}

initDb()
  .then(() => {
    logger.info("DB initialized");
    app.listen(PORT, () => {
      logger.info("Server started", { port: PORT });
      startAutoRefresh();
      startStaffPunishmentsSync();
      // Auto-refresh on startup to populate DB
      if (!refreshInProgress) {
        logger.info("Auto refresh on startup");
        refreshAllData().catch((error) => {
          logger.error("Startup refresh failed", { error: error.message });
        });
      }
    });
  })
  .catch((error) => {
    const detail =
      (error && error.message) ||
      (typeof error === "string" ? error : "") ||
      String(error);
    const code = error && error.code ? String(error.code) : null;
    const stack =
      error && error.stack ? String(error.stack).slice(0, 2500) : null;

    logger.error("Failed to init DB", {
      err: detail || "unknown error",
      code,
      stack
    });
    console.error("Failed to init DB:", detail || error, code || "");
    process.exit(1);
  });
