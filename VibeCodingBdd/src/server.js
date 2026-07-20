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
  getAllProfiles,
  getStaffPunishments,
  getStaffPunishmentStats,
  getVdfHistory,
  getVdfHistoryCount,
  getPunishmentLogs,
  getPunishmentLogsCount,
  loginSiteUser,
  logSiteLogin,
  deleteSiteUser,
  getSiteSession,
  deleteSiteSession,
  createSiteUser,
  getStaffStatsForPeriod,
  findAdminByDiscordId,
  getSiteRoleRank,
  MIN_SITE_ROLE_RANK,
  getHiddenStaff,
  addHiddenStaff,
  removeHiddenStaff,
  isOwner,
  getOwners,
  addOwner,
  removeOwner,
  getReportsCount,
  getTabAccess,
  updateTabAccess
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
const OWNER_DISCORD_IDS = new Set(["1500235583367417866"]);

async function fetchDiscordMember(discordUserId) {
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
  return await resp.json();
}

async function fetchDiscordMemberRoles(discordUserId) {
  const member = await fetchDiscordMember(discordUserId);
  return member ? member.roles || [] : null;
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
        res.end(JSON.stringify({ detail: "Internal error" }));
      });
    });
  } else {
    handleCheckerApi(req, res, req.originalUrl).catch(err => {
      logger.error("Checker API error", { error: err.message });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "Internal error" }));
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

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(authMiddleware);

const rateLimitStore = new Map();
function rateLimit(key, maxAttempts, windowMs) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (entry && now - entry.start < windowMs) {
    if (entry.count >= maxAttempts) return false;
    entry.count++;
  } else {
    rateLimitStore.set(key, { start: now, count: 1 });
  }
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of rateLimitStore) { if (now - v.start > 120000) rateLimitStore.delete(k); } }, 120000);

function sanitizeError(msg) { return "Ошибка сервера"; }

function validateUsername(u) { return typeof u === "string" && u.trim().length >= 3 && u.trim().length <= 32 && /^[a-zA-Z0-9_\-]+$/.test(u.trim()); }
function validatePassword(p) { return typeof p === "string" && p.length >= 6 && p.length <= 128; }

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });
    if (!validateUsername(username)) return res.status(400).json({ error: "Некорректный логин (3-32 символа, латиница, цифры, _ -)" });
    if (!validatePassword(password)) return res.status(400).json({ error: "Некорректный пароль (6-128 символов)" });
    const ip = req.ip || req.connection.remoteAddress;
    const rlKey = "login:" + ip;
    if (!rateLimit(rlKey, 10, 60000)) return res.status(429).json({ error: "Слишком много попыток. Подождите минуту" });
    const result = await loginSiteUser(username.trim(), password);
    if (!result) {
      logSiteLogin(null, username.trim(), ip, req.headers['user-agent'], 'login_failed', 'Invalid credentials');
      return res.status(401).json({ error: "Неверный логин или пароль" });
    }
    logSiteLogin(result.user.id, username.trim(), ip, req.headers['user-agent'], 'login', 'OK');
    res.cookie("session_token", result.token, {
      httpOnly: true,
      secure: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax"
    });
    res.json({ ok: true, user: result.user });
  } catch (error) {
    logger.error("Login failed", { error: error.message });
    res.status(500).json({ error: sanitizeError() });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password, discord_id } = req.body;
    if (!username || !password || !discord_id) return res.status(400).json({ error: "Логин, пароль и Discord ID обязательны" });
    if (!validateUsername(username)) return res.status(400).json({ error: "Некорректный логин (3-32 символа, латиница, цифры, _ -)" });
    if (!validatePassword(password)) return res.status(400).json({ error: "Пароль должен быть 6-128 символов" });
    if (!/^\d{17,20}$/.test(discord_id)) return res.status(400).json({ error: "Некорректный Discord ID" });
    const ip = req.ip || req.connection.remoteAddress;
    const rlKey = "register:" + ip;
    if (!rateLimit(rlKey, 5, 300000)) return res.status(429).json({ error: "Слишком много регистраций. Подождите 5 минут" });
    const isOwnerUser = OWNER_DISCORD_IDS.has(discord_id);
    let memberRoles = null;
    let resolved = null;
    if (!isOwnerUser) {
      memberRoles = await fetchDiscordMemberRoles(discord_id);
      if (!memberRoles) return res.status(403).json({ error: "Пользователь не найден в сервере Discord" });
      resolved = resolveDiscordRole(memberRoles);
      if (!resolved || resolved.rank < MIN_DISCORD_ROLE_RANK) {
        return res.status(403).json({ error: "Недостаточно прав. Доступ только для мл. модератора и выше" });
      }
    }
    const user = await createSiteUser(username.trim(), password, null, discord_id, resolved ? resolved.label : 'Владелец');
    res.json({ ok: true, user });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Логин уже занят" });
    logger.error("Register failed", { error: error.message });
    res.status(500).json({ error: sanitizeError() });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (req.user) {
    logSiteLogin(req.user.user_id, req.user.username, ip, req.headers['user-agent'], 'logout', 'OK');
  }
  const token = req.cookies?.session_token;
  if (token) await deleteSiteSession(token);
  res.clearCookie("session_token");
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  logSiteLogin(req.user.user_id, req.user.username, ip, req.headers['user-agent'], 'session_active', 'GET /api/auth/me');
  var user = { id: req.user.user_id, username: req.user.username, role: req.user.role, discord_name: req.user.discord_name, discord_id: req.user.discord_id };
  if (req.user.discord_id) {
    try {
      const profResult = await require("./db").pool.query(
        `SELECT steamid FROM profiles WHERE discord_id = $1 LIMIT 1`,
        [String(req.user.discord_id)]
      );
      if (profResult.rows.length) user.steamid = profResult.rows[0].steamid;
    } catch (_) {}
    try {
      var member = await fetchDiscordMember(req.user.discord_id);
      if (member && member.user) {
        user.discord_avatar = member.user.avatar ? "https://cdn.discordapp.com/avatars/" + req.user.discord_id + "/" + member.user.avatar + ".png?size=64" : null;
        user.discord_display = member.nick || member.user.global_name || member.user.username;
        var resolved = resolveDiscordRole(member.roles || []);
        user.discord_role = resolved ? resolved.label : null;
        user.discord_role_rank = resolved ? resolved.rank : 0;
      }
    } catch (e) { logger.error("Discord fetch failed in /api/auth/me", { error: e.message, discord_id: req.user.discord_id }); }
  }
  if (req.user.discord_id && OWNER_DISCORD_IDS.has(String(req.user.discord_id))) {
    user.discord_role_rank = 15;
    user.discord_role = 'Владелец';
  }
  res.json({ user });
});

app.get("/api/dashboard/stats", async (_req, res) => {
  try {
    let adminsOnline = 0, playersOnline = 0;
    try {
      const data = await fetchJson("/servers/");
      const servers = Array.isArray(data) ? data : (data.servers || []);
      for (const s of servers) {
        const players = (s.live_data && s.live_data.players) || [];
        for (const p of players) {
          if (p.is_admin) adminsOnline++;
          playersOnline++;
        }
      }
    } catch (_) {}
    const reportsCount = await getReportsCount();
    res.json({ adminsOnline, playersOnline, reportsCount });
  } catch (error) {
    logger.error("Failed to get dashboard stats", { error: error.message });
    res.json({ adminsOnline: 0, playersOnline: 0, reportsCount: 0 });
  }
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
    const EXCLUDED_ROLE_KEYS = new Set(["admin", "admin+", "ADMIN", "ADMIN+", "UNDEFINED", "Медиа", "MEDIA", "МЕДИА"]);
    const EXCLUDED_STEAMIDS = new Set(["76561198007541774", "76561199077499521", "76561198388989868", "76561198283135025", "76561199077199811", "76561199097711339", "76561198121797965"]);

    const staffMap = {};
    for (const row of stats) {
      const sid = row.admin_steamid;
      const roleKey = row.role_key || "STAFF";
      const roleKeyUpper = (roleKey || "").toUpperCase();
      if (EXCLUDED_STEAMIDS.has(sid)) continue;
      if (EXCLUDED_ROLE_KEYS.has(roleKey) || EXCLUDED_ROLE_KEYS.has(roleKeyUpper)) continue;
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
      .filter(s => (s.bans + s.mutes) > 0)
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
    res.status(500).json({ error: "Internal server error" });
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
    const staffOnly = req.query.staffOnly === '1';
    const { rows, total } = await listStaffWithServers(limit, offset, search, sortBy, sortDir, staffOnly);
    res.json({ rows, total, limit, offset });
  } catch (error) {
    logger.error("Failed to get admins", { error: error.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/all-profiles", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const search = String(req.query.search || '').trim();
    const sortBy = String(req.query.sortBy || 'created_at');
    const sortDir = String(req.query.sortDir || 'DESC');
    const { rows, total } = await getAllProfiles(limit, offset, search, sortBy, sortDir);
    res.json({ rows, total, limit, offset });
  } catch (error) {
    logger.error("Failed to get all profiles", { error: error.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/unconfigured-profiles", async (_req, res) => {
  try {
    const dbPool = require("./db").pool;
    const r = await dbPool.query(`
      SELECT p.steamid, p.name, p.kills, p.deaths, p.playtime,
             p.avatar_full, p.discord_id, p.discord_nickname,
             (p.raw_json->>'created_at') AS fear_created_at,
             a.group_name, a.group_display_name
      FROM profiles p
      LEFT JOIN admins a ON a.steamid = p.steamid
      WHERE (p.discord_id IS NULL OR p.discord_id = '')
        AND a.steamid IS NOT NULL
      ORDER BY (p.raw_json->>'created_at') DESC NULLS LAST
      LIMIT 50
    `);
    res.json({ profiles: r.rows });
  } catch (error) { res.status(500).json({ error: "Internal server error" }); }
});

app.get("/api/active-reports", async (_req, res) => {
  try {
    const cookie = process.env.FEAR_COOKIE || (process.env.ACCESS_TOKEN ? `access_token=${process.env.ACCESS_TOKEN}` : null);
    const headers = {
      'accept': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'origin': 'https://fearproject.ru',
      'referer': 'https://fearproject.ru/'
    };
    if (cookie) headers.cookie = cookie;
    const resp = await fetch('https://fearproject.ru/api/reports/recent', {
      headers,
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return res.json({ reports: [] });
    const data = await resp.json();
    const reports = Array.isArray(data) ? data : (data.reports || data.data || []);
    res.json({ reports });
  } catch (_) { res.json({ reports: [] }); }
});

app.get("/api/refresh-status", (_req, res) => {
  const safeInfo = lastRefreshInfo ? {
    runId: lastRefreshInfo.runId,
    startedAt: lastRefreshInfo.startedAt,
    finishedAt: lastRefreshInfo.finishedAt,
    adminsTotal: lastRefreshInfo.adminsTotal,
    profilesOk: lastRefreshInfo.profilesOk,
    profilesFailed: lastRefreshInfo.profilesFailed,
    hasError: !!lastRefreshInfo.errorText
  } : null;
  res.json({ refreshInProgress, lastRefreshInfo: safeInfo });
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

async function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (req.user.discord_id && OWNER_DISCORD_IDS.has(String(req.user.discord_id))) {
    return next();
  }
  if (req.user.discord_id) {
    const member = await fetchDiscordMember(req.user.discord_id);
    if (member) {
      const resolved = resolveDiscordRole(member.roles || []);
      if (resolved && (resolved.label === "Владелец" || resolved.label === "Куратор")) {
        return next();
      }
    }
  }
  const check = await isOwner(String(req.user.steamid || req.user.username));
  if (check) return next();
  return res.status(403).json({ error: "Только владелец" });
}

app.get("/api/hidden-staff", requireOwner, async (_req, res) => {
  try {
    const list = await getHiddenStaff();
    res.json({ hidden: list });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/hidden-staff", requireOwner, async (req, res) => {
  try {
    const { steamid } = req.body;
    if (!steamid) return res.status(400).json({ error: "steamid required" });
    await addHiddenStaff(String(steamid), req.user.username);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/hidden-staff/:steamid", requireOwner, async (req, res) => {
  try {
    await removeHiddenStaff(req.params.steamid);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/owners", requireOwner, async (_req, res) => {
  try {
    const list = await getOwners();
    res.json({ owners: list });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/owners", requireOwner, async (req, res) => {
  try {
    const { steamid } = req.body;
    if (!steamid) return res.status(400).json({ error: "steamid required" });
    await addOwner(String(steamid), req.user.username);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/owners/:steamid", requireOwner, async (req, res) => {
  try {
    await removeOwner(req.params.steamid);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/admin/users", requireOwner, async (_req, res) => {
  try {
    const r = await require("./db").pool.query(
      `SELECT u.id, u.username, u.discord_name, u.discord_id, u.role, u.is_active, u.created_at,
              (SELECT COUNT(*) FROM site_sessions s WHERE s.user_id = u.id AND s.expires_at > NOW()) AS active_sessions,
              (SELECT l.ip_address FROM panel_login_logs l WHERE l.user_id = u.id ORDER BY l.created_at DESC LIMIT 1) AS last_ip,
              (SELECT l.created_at FROM panel_login_logs l WHERE l.user_id = u.id ORDER BY l.created_at DESC LIMIT 1) AS last_login
       FROM site_users u ORDER BY u.created_at DESC`
    );
    res.json({ users: r.rows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/admin/users/:id/sessions", requireOwner, async (req, res) => {
  try {
    const r = await require("./db").pool.query(
      `SELECT token, created_at, expires_at FROM site_sessions WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ sessions: r.rows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/admin/users/:id/delete", requireOwner, async (req, res) => {
  try {
    const uid = Number(req.params.id);
    if (!uid) return res.status(400).json({ error: "Invalid user id" });
    if (uid === req.user.user_id) return res.status(400).json({ error: "Нельзя удалить себя" });
    await deleteSiteUser(uid);
    logSiteLogin(req.user.user_id, req.user.username, req.ip || req.connection.remoteAddress, req.headers['user-agent'], 'delete_user', 'Deleted user #' + uid);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/admin/users/:id/role", requireOwner, async (req, res) => {
  try {
    const uid = Number(req.params.id);
    const { role } = req.body;
    if (!uid || !role) return res.status(400).json({ error: "Invalid params" });
    const allowed = ['user', 'Мл. Модератор', 'Модератор', 'Модератор Discord', 'Модератор месяца', 'Ст. Модератор', 'Спец. Администратор', 'Ст. Администратор', 'Гл. Администратор', 'Разработчик', 'Куратор', 'Владелец'];
    if (!allowed.includes(role)) return res.status(400).json({ error: "Invalid role" });
    await require("./db").pool.query(`UPDATE site_users SET role = $1 WHERE id = $2`, [role, uid]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Analytics APIs ──
app.get("/api/analytics/overview", requireOwner, async (_req, res) => {
  try {
    const db = require("./db").pool;
    const peakRow = (await db.query(`SELECT COALESCE(MAX(peak_online), 0) as peak FROM server_online_history WHERE ts > NOW() - INTERVAL '24 hours'`)).rows[0];
    const avgRow = (await db.query(`SELECT COALESCE(AVG(online), 0)::int as avg FROM server_online_history WHERE ts > NOW() - INTERVAL '24 hours'`)).rows[0];
    const totalDrops = (await db.query(`SELECT COUNT(*)::int as cnt FROM drop_log`)).rows[0];
    const todayDrops = (await db.query(`SELECT COUNT(*)::int as cnt FROM drop_log WHERE created_at > NOW() - INTERVAL '24 hours'`)).rows[0];
    res.json({ peakOnline: peakRow.peak, avgOnline: avgRow.avg, totalDrops: totalDrops.cnt, todayDrops: todayDrops.cnt });
  } catch (error) { res.status(500).json({ error: "Internal server error" }); }
});

app.get("/api/analytics/online-history", requireOwner, async (_req, res) => {
  try {
    const db = require("./db").pool;
    const r = await db.query(`SELECT ts, online, admins_online, players_online, peak_online FROM server_online_history WHERE ts > NOW() - INTERVAL '24 hours' ORDER BY ts ASC`);
    const points = r.rows.map(row => {
      const d = new Date(row.ts);
      return { label: d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }), online: row.online, admins: row.admins_online, players: row.players_online, peak: row.peak_online };
    });
    res.json({ points });
  } catch (error) { res.status(500).json({ error: "Internal server error" }); }
});

app.get("/api/analytics/staff-top", requireOwner, async (req, res) => {
  try {
    const dbPool = require("./db").pool;
    const period = String(req.query.period || 'week');
    let intervalHours = 168;
    if (period === 'day') intervalHours = 24;
    else if (period === 'month') intervalHours = 720;
    const sinceMs = Date.now() - intervalHours * 3600 * 1000;
    const sinceSec = Math.floor(sinceMs / 1000);
    const r = await dbPool.query(`
      SELECT admin_steamid, admin, type, status, COUNT(*)::int as count
      FROM punishments
      WHERE admin_steamid IS NOT NULL AND admin_steamid != ''
        AND created >= $1
      GROUP BY admin_steamid, admin, type, status
    `, [sinceSec]);
    const byAdmin = {};
    (r.rows || []).forEach(s => {
      if (!s.admin_steamid) return;
      if (s.status === 2) return;
      if (!byAdmin[s.admin_steamid]) byAdmin[s.admin_steamid] = { steamid: s.admin_steamid, name: s.admin || s.admin_steamid, bans: 0, mutes: 0 };
      if (s.type === 1) byAdmin[s.admin_steamid].bans += s.count;
      else if (s.type === 2) byAdmin[s.admin_steamid].mutes += s.count;
    });
    const rows = Object.values(byAdmin).sort((a, b) => (b.bans + b.mutes) - (a.bans + a.mutes)).slice(0, 10);
    res.json({ rows });
  } catch (error) { res.status(500).json({ error: "Internal server error" }); }
});

app.get("/api/analytics/drops-summary", requireOwner, async (_req, res) => {
  try {
    const db = require("./db").pool;
    const total = (await db.query(`SELECT COUNT(*)::int as skins, COUNT(DISTINCT steamid)::int as players, COALESCE(SUM(price), 0)::int as value FROM drop_log`)).rows[0];
    const today = (await db.query(`SELECT COUNT(*)::int as skins, COUNT(DISTINCT steamid)::int as players FROM drop_log WHERE created_at > NOW() - INTERVAL '24 hours'`)).rows[0];
    res.json({ totalSkins: total.skins, totalPlayers: total.players, totalValue: total.value, todaySkins: today.skins, todayPlayers: today.players });
  } catch (error) { res.status(500).json({ error: "Internal server error" }); }
});

app.get("/api/analytics/drops", requireOwner, async (req, res) => {
  try {
    const period = Number(req.query.period) || 0;
    const page = Math.max(Number(req.query.page) || 0, 0);
    const limit = 20;
    const db = require("./db").pool;
    let where = '';
    if (period === 0) where = "WHERE created_at > NOW() - INTERVAL '24 hours'";
    else if (period === 1) where = "WHERE created_at > NOW() - INTERVAL '7 days'";
    else if (period === 2) where = "WHERE created_at > NOW() - INTERVAL '30 days'";
    const total = (await db.query(`SELECT COUNT(*)::int as cnt FROM drop_log ${where}`)).rows[0].cnt;
    const r = await db.query(`SELECT steamid, player_name, skin_name, skin_weapon, price, created_at FROM drop_log ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, page * limit]);
    res.json({ drops: r.rows, total, page, limit });
  } catch (error) { res.status(500).json({ error: "Internal server error" }); }
});

app.get("/api/admin/login-logs", requireOwner, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const r = await require("./db").pool.query(
      `SELECT l.id, l.user_id, l.ip_address, l.user_agent, l.action, l.details, l.created_at,
              u.username
       FROM panel_login_logs l
       LEFT JOIN site_users u ON u.id = l.user_id
       ORDER BY l.created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ logs: r.rows });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/my-stats", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    let steamid = req.user.steamid || req.user.username;
    if (req.user.discord_id) {
      const prof = await require("./db").pool.query(
        `SELECT steamid FROM profiles WHERE discord_id = $1 LIMIT 1`,
        [String(req.user.discord_id)]
      );
      if (prof.rows.length) steamid = prof.rows[0].steamid;
    }
    if (!steamid) return res.json({ steamid: null, bans: 0, mutes: 0, rows: [] });
    const stats = await getStaffPunishments(steamid, 0, 200);
    let filtered = stats || [];
    if (req.query.from && req.query.to) {
      const dateFrom = new Date(req.query.from);
      const dateTo = new Date(req.query.to);
      if (!isNaN(dateFrom.getTime()) && !isNaN(dateTo.getTime())) {
        filtered = filtered.filter(r => {
          if (!r.created) return true;
          const ts = r.created < 1e12 ? r.created * 1000 : r.created;
          const d = new Date(ts);
          return d >= dateFrom && d <= dateTo;
        });
      }
    }
    let bans = 0, mutes = 0;
    filtered.forEach(r => {
      if (r.status === 2) return;
      if (r.type === 1) bans++;
      else if (r.type === 2) mutes++;
    });
    res.json({ steamid, bans, mutes, total: bans + mutes, rows: filtered });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/punishments/staff/stats", async (_req, res) => {
  try {
    const admins = await listAdminsWithProfiles();
    const steamids = admins.map((a) => a.steamid).filter(Boolean);
    const stats = await getStaffPunishmentStats(steamids);
    res.json(stats);
  } catch (error) {
    logger.error("Failed to get staff punishment stats", { error: error.message });
    res.status(500).json({ error: "Internal server error" });
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
    res.status(500).json({ error: "Internal server error" });
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
    res.status(500).json({ error: "Internal server error" });
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
    const [profilesMap, hiddenStaff] = await Promise.all([
      getProfilesBySteamids(uniqueSteamids),
      getHiddenStaff()
    ]);
    const hiddenSet = new Set(hiddenStaff.map(h => h.steamid));
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
          p.db_group_name = prof.group_name;
          p.db_group_display_name = prof.group_display_name;
          p.db_hidden = hiddenSet.has(p.steam_id);
        }
      });
    });
    res.json({ servers });
  } catch (error) {
    logger.error("Failed to fetch servers", { error: error.message });
    res.status(500).json({ error: "Internal server error" });
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
    res.status(500).json({ error: "Internal server error" });
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

// ── Online poller: polls Fear API every 15s, stores hourly snapshots ──
let _onlinePollerLastHour = -1;
let _onlinePollerPeak = 0;

function startOnlinePoller() {
  setInterval(async () => {
    try {
      const { fetchJson } = require("./fearApi");
      const servers = await fetchJson("/servers/");
      if (!Array.isArray(servers)) return;
      let playersOnline = 0;
      let adminsOnline = 0;
      servers.forEach(s => {
        const ppl = s.players || [];
        playersOnline += ppl.length;
        ppl.forEach(p => { if (p.is_admin) adminsOnline++; });
      });
      const now = new Date();
      const currentHour = now.getHours();
      if (playersOnline > _onlinePollerPeak) _onlinePollerPeak = playersOnline;
      if (currentHour !== _onlinePollerLastHour) {
        _onlinePollerLastHour = currentHour;
        _onlinePollerPeak = playersOnline;
        const db = require("./db").pool;
        await db.query(
          `INSERT INTO server_online_history (ts, online, admins_online, players_online, peak_online, servers_json)
           VALUES (NOW(), $1, $2, $3, $4, $5)`,
          [playersOnline, adminsOnline, playersOnline, _onlinePollerPeak, JSON.stringify(servers.map(s => ({ name: s.site_name, players: (s.players || []).length, map: s.map }))).slice(0, 2000)]
        );
      }
    } catch (e) { /* silent */ }
  }, 15000);
  logger.info("Online poller started (every 15s, hourly snapshots)");
}

// ===================== OWNER SETTINGS =====================
let techMode = false;

app.get("/api/owner/settings", requireOwner, (req, res) => {
  res.json({
    techMode,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    nodeVersion: process.version,
    platform: process.platform
  });
});

app.post("/api/owner/tech-mode", requireOwner, (req, res) => {
  techMode = !techMode;
  logger.info("Tech mode toggled", { techMode });
  res.json({ techMode });
});

app.post("/api/owner/force-refresh", requireOwner, async (req, res) => {
  if (refreshInProgress) return res.status(409).json({ error: "Refresh already running" });
  res.json({ ok: true, message: "Обновление запущено" });
  refreshAllData().catch(error => logger.error("Force refresh failed", { error: error.message }));
});

const EXCLUDED_STEAMIDS_SET = new Set(["76561198007541774", "76561199077499521", "76561198388989868", "76561198283135025", "76561199077199811", "76561199097711339", "76561198121797965"]);
const STAFF_EXCLUDED_GROUPS = new Set(["admin", "admin+", "ADMIN", "ADMIN+", "UNDEFINED", "Медиа", "MEDIA", "МЕДИА"]);

app.get("/api/staff-overview", requireOwner, async (_req, res) => {
  try {
    const dbPool = require("./db").pool;
    const excludedArr = [...EXCLUDED_STEAMIDS_SET];
    const r = await dbPool.query(`
      SELECT
        p.steamid,
        COALESCE(p.name, a.raw_json->>'name') AS name,
        p.kills, p.deaths, p.playtime, p.rank,
        p.avatar_full,
        (p.raw_json->>'created_at') AS fear_created_at,
        a.group_name, a.group_display_name
      FROM profiles p
      LEFT JOIN admins a ON a.steamid = p.steamid
      WHERE a.steamid IS NOT NULL
        AND a.steamid != ALL($1)
        AND LOWER(COALESCE(a.group_name, '')) NOT LIKE 'admin%'
        AND LOWER(COALESCE(a.group_name, '')) NOT LIKE '%media%'
    `, [excludedArr]);
    const staff = r.rows;
    const byKd = staff.filter(s => s.kills > 0 && s.deaths > 0)
      .map(s => ({ ...s, kd: (s.kills / s.deaths).toFixed(2), kdNum: s.kills / s.deaths }))
      .sort((a, b) => b.kdNum - a.kdNum)
      .slice(0, 5);
    const byNewest = staff.filter(s => s.fear_created_at)
      .map(s => ({ ...s, createdMs: new Date(s.fear_created_at).getTime() }))
      .sort((a, b) => b.createdMs - a.createdMs)
      .slice(0, 5);
    const byLowHours = staff.filter(s => s.playtime != null && s.playtime > 0)
      .sort((a, b) => a.playtime - b.playtime)
      .slice(0, 5);
    const totalStaff = staff.length;
    const avgKd = staff.filter(s => s.kills > 0 && s.deaths > 0)
      .reduce((acc, s) => { acc.sum += s.kills / s.deaths; acc.cnt++; return acc; }, { sum: 0, cnt: 0 });
    const avgPlaytime = staff.filter(s => s.playtime != null && s.playtime > 0)
      .reduce((acc, s) => { acc.sum += s.playtime; acc.cnt++; return acc; }, { sum: 0, cnt: 0 });
    res.json({
      totalStaff,
      avgKd: avgKd.cnt > 0 ? (avgKd.sum / avgKd.cnt).toFixed(2) : "-",
      avgPlaytime: avgPlaytime.cnt > 0 ? Math.round(avgPlaytime.sum / avgPlaytime.cnt / 3600) : 0,
      topKd: byKd,
      newestAccounts: byNewest,
      lowestHours: byLowHours
    });
  } catch (error) { res.status(500).json({ error: "Internal server error" }); }
});

app.get("/api/tab-access", async (req, res) => {
  try {
    const tabs = await getTabAccess();
    res.json({ tabs });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/tab-access", requireOwner, async (req, res) => {
  try {
    const { tabId, minRoleRank, enabled } = req.body;
    if (!tabId) return res.status(400).json({ error: "tabId required" });
    await updateTabAccess(tabId, minRoleRank ?? 7, enabled ?? true);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/owner/system", requireOwner, async (req, res) => {
  try {
    const dbPool = require("./db").pool;
    const adminCount = (await dbPool.query("SELECT COUNT(*) FROM admins")).rows[0].count;
    const profilesCount = (await dbPool.query("SELECT COUNT(*) FROM profiles")).rows[0].count;
    const punishmentsCount = (await dbPool.query("SELECT COUNT(*) FROM punishments")).rows[0].count;
    const usersCount = (await dbPool.query("SELECT COUNT(*) FROM site_users")).rows[0].count;
    let dbSize = 0;
    try {
      const sizeResult = await dbPool.query("SELECT pg_database_size(current_database()) AS size");
      dbSize = Number(sizeResult.rows[0].size);
    } catch (_) {}
    let totalAdminsOnline = 0;
    try {
      const data = await fetchJson("/servers/");
      const servers = Array.isArray(data) ? data : (data.servers || []);
      for (const s of servers) {
        const players = (s.live_data && s.live_data.players) || [];
        for (const p of players) {
          if (p.is_admin) totalAdminsOnline++;
        }
      }
    } catch (_) {}
    res.json({
      adminCount: Number(adminCount),
      profilesCount: Number(profilesCount),
      punishmentsCount: Number(punishmentsCount),
      usersCount: Number(usersCount),
      uptime: Math.floor(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      dbSize,
      totalAdminsOnline,
      siteUrl: process.env.SITE_URL || req.protocol + "://" + req.get("host"),
      nodeVersion: process.version,
      techMode
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.use((err, _req, res, _next) => {
  logger.error("Unhandled error", { error: err.message, stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
});

initDb()
  .then(() => {
    logger.info("DB initialized");
    app.listen(PORT, () => {
      logger.info("Server started", { port: PORT });
      startAutoRefresh();
      startStaffPunishmentsSync();
      startOnlinePoller();
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
