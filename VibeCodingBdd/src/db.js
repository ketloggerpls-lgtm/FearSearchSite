const { Pool } = require("pg");
const logger = require("./logger");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("DATABASE_URL is not set. Database features will be unavailable.");
}

function resolveSslConfig(dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    const host = parsed.hostname || "";
    if (host === "localhost" || host.endsWith(".railway.internal")) {
      return false;
    }
  } catch (_error) {
    // Keep default SSL behavior for malformed/unexpected URLs.
  }

  return { rejectUnauthorized: false };
}

const pool = connectionString ? new Pool({
  connectionString,
  ssl: resolveSslConfig(connectionString)
}) : null;

if (pool) {
  pool.on("error", (error) => {
    logger.error("PostgreSQL pool error", { error: error.message });
  });
}

async function initDb() {
  if (!pool) {
    logger.warn("DATABASE_URL not set, skipping DB init");
    return;
  }
  try {
    await pool.query("SELECT 1 AS ok");
  } catch (error) {
    logger.error("Database connection check failed", {
      err: error.message || String(error),
      code: error.code || null
    });
    throw error;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      admin_id BIGINT PRIMARY KEY,
      steamid TEXT NOT NULL UNIQUE,
      group_id INTEGER,
      group_display_name TEXT,
      group_name TEXT,
      immunity INTEGER,
      is_frozen BOOLEAN DEFAULT FALSE,
      avatar_full TEXT,
      raw_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
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
      raw_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_runs (
      id BIGSERIAL PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      admins_total INTEGER NOT NULL DEFAULT 0,
      profiles_ok INTEGER NOT NULL DEFAULT 0,
      profiles_failed INTEGER NOT NULL DEFAULT 0,
      error_text TEXT
    )
  `);

  await pool.query(`
    ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS discord_nickname TEXT
  `);
  await pool.query(`
    ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS discord_id TEXT
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS punishments (
      id BIGINT PRIMARY KEY,
      type SMALLINT NOT NULL CHECK (type IN (1, 2)),
      steamid TEXT NOT NULL,
      name TEXT NOT NULL,
      admin TEXT,
      admin_steamid TEXT,
      admin_avatar TEXT,
      avatar TEXT,
      reason TEXT NOT NULL,
      status INTEGER NOT NULL,
      duration INTEGER NOT NULL,
      created BIGINT NOT NULL,
      expires BIGINT NOT NULL,
      unban_price INTEGER,
      raw_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_punishments_type_created ON punishments(type, created DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_punishments_steamid ON punishments(steamid)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_punishments_admin_steamid ON punishments(admin_steamid)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      discord_name TEXT,
      discord_id TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS panel_login_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES site_users(id) ON DELETE SET NULL,
      username TEXT,
      ip_address TEXT,
      user_agent TEXT,
      action TEXT NOT NULL DEFAULT 'login',
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
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
      attachment_url TEXT,
      message_url TEXT,
      on_fear BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hidden_staff (
      id SERIAL PRIMARY KEY,
      steamid TEXT NOT NULL UNIQUE,
      hidden_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS owners (
      id SERIAL PRIMARY KEY,
      steamid TEXT NOT NULL UNIQUE,
      added_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tab_access (
      id SERIAL PRIMARY KEY,
      tab_id TEXT NOT NULL UNIQUE,
      min_role_rank INT NOT NULL DEFAULT 7,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const defaultTabs = [
    { id: 'online', min: 7 }, { id: 'all', min: 7 }, { id: 'stats', min: 7 },
    { id: 'logs', min: 9 }, { id: 'mystats', min: 7 }, { id: 'adminpanel', min: 15 }
  ];
  for (const t of defaultTabs) {
    await pool.query(
      `INSERT INTO tab_access (tab_id, min_role_rank, enabled) VALUES ($1, $2, TRUE) ON CONFLICT (tab_id) DO NOTHING`,
      [t.id, t.min]
    );
  }
  await pool.query(`INSERT INTO owners (steamid, added_by) VALUES ($1, 'seed') ON CONFLICT (steamid) DO NOTHING`, ['76561198675051863']);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS panel_registration_confirmations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
      discord_id TEXT,
      confirmation_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      level INTEGER,
      expires_at BIGINT NOT NULL,
      confirmed_at BIGINT,
      rejected_at BIGINT,
      created_at BIGINT NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reg_confirm_code ON panel_registration_confirmations(confirmation_code)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS server_online_history (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      online INT NOT NULL DEFAULT 0,
      admins_online INT NOT NULL DEFAULT 0,
      players_online INT NOT NULL DEFAULT 0,
      peak_online INT NOT NULL DEFAULT 0,
      servers_json JSONB
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_online_history_ts ON server_online_history(ts)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS drop_log (
      id SERIAL PRIMARY KEY,
      steamid TEXT NOT NULL,
      player_name TEXT,
      skin_name TEXT,
      skin_weapon TEXT,
      skin_wear TEXT,
      price NUMERIC DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_drop_log_ts ON drop_log(created_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_drop_log_steamid ON drop_log(steamid)`);
}

async function createRefreshRun() {
  const result = await pool.query(
    `INSERT INTO refresh_runs DEFAULT VALUES RETURNING id`
  );
  return result.rows[0].id;
}

async function finalizeRefreshRun(id, data) {
  await pool.query(
    `
      UPDATE refresh_runs
      SET finished_at = NOW(),
          admins_total = $2,
          profiles_ok = $3,
          profiles_failed = $4,
          error_text = $5
      WHERE id = $1
    `,
    [id, data.adminsTotal, data.profilesOk, data.profilesFailed, data.errorText]
  );
}

async function upsertAdmin(admin) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        DELETE FROM admins
        WHERE admin_id = $1 OR steamid = $2
      `,
      [admin.admin_id, admin.steamid]
    );
    await client.query(
      `
        INSERT INTO admins (
          admin_id, steamid, group_id, group_display_name, group_name,
          immunity, is_frozen, avatar_full, raw_json, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()
        )
      `,
      [
        admin.admin_id,
        admin.steamid,
        admin.group_id,
        admin.group_display_name,
        admin.group_name,
        admin.immunity,
        admin.is_frozen,
        admin.avatar_full,
        admin
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertProfile(profile) {
  const stats = profile.stats || {};
  const banInfo = profile.banInfo || {};
  const vipInfo = profile.vipInfo || {};
  const discord = profile.discord || {};
  const discordNickname =
    profile.discordNickname ??
    profile.discord_nickname ??
    discord.nickname ??
    discord.name ??
    null;
  const discordId =
    profile.providerUserId ??
    profile.provider_user_id ??
    profile.discordId ??
    profile.discord_id ??
    discord.id ??
    discord.userId ??
    null;

  await pool.query(
    `
      INSERT INTO profiles (
        steamid, name, last_activity, avatar_full, discord_nickname, discord_id,
        rank, kills, deaths, playtime, ban_is_banned, vip_is_vip, raw_json, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
      )
      ON CONFLICT (steamid) DO UPDATE SET
        name = EXCLUDED.name,
        last_activity = EXCLUDED.last_activity,
        avatar_full = EXCLUDED.avatar_full,
        discord_nickname = EXCLUDED.discord_nickname,
        discord_id = EXCLUDED.discord_id,
        rank = EXCLUDED.rank,
        kills = EXCLUDED.kills,
        deaths = EXCLUDED.deaths,
        playtime = EXCLUDED.playtime,
        ban_is_banned = EXCLUDED.ban_is_banned,
        vip_is_vip = EXCLUDED.vip_is_vip,
        raw_json = EXCLUDED.raw_json,
        updated_at = NOW()
    `,
    [
      profile.steamid,
      profile.name,
      profile.last_activity || null,
      profile.avatar_full || null,
      discordNickname,
      discordId,
      stats.rank || null,
      stats.kills || null,
      stats.deaths || null,
      stats.playtime || null,
      Boolean(banInfo.isBanned),
      Boolean(vipInfo.isVip),
      profile
    ]
  );
}

async function listAdminsWithProfiles() {
  const result = await pool.query(`
    SELECT
      a.admin_id,
      a.steamid,
      a.group_display_name,
      a.group_name,
      a.immunity,
      a.is_frozen,
      COALESCE(p.name, (a.raw_json->>'name')) AS name,
      COALESCE(p.avatar_full, a.avatar_full) AS avatar_full,
      p.rank,
      p.kills,
      p.deaths,
      p.playtime,
      COALESCE(
        p.discord_nickname,
        p.raw_json->>'discordNickname',
        p.raw_json->>'discord_nickname',
        p.raw_json->'discord'->>'nickname',
        p.raw_json->'discord'->>'name'
      ) AS discord_nickname,
      COALESCE(
        p.discord_id,
        p.raw_json->>'providerUserId',
        p.raw_json->>'provider_user_id',
        p.raw_json->>'discordId',
        p.raw_json->>'discord_id',
        p.raw_json->'discord'->>'id',
        p.raw_json->'discord'->>'userId'
      ) AS discord_id,
      p.last_activity,
      p.ban_is_banned,
      p.vip_is_vip,
      GREATEST(a.updated_at, COALESCE(p.updated_at, a.updated_at)) AS updated_at
    FROM admins a
    LEFT JOIN profiles p ON p.steamid = a.steamid
    ORDER BY a.admin_id DESC
  `);

  return result.rows;
}

async function listAdminsWithProfilesPaginated(limit = 50, offset = 0, search = '') {
  const params = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    where = `WHERE (COALESCE(p.name, a.raw_json->>'name') ILIKE $1
      OR a.steamid ILIKE $2
      OR COALESCE(p.discord_nickname, p.raw_json->>'discordNickname') ILIKE $3
      OR a.group_display_name ILIKE $4
      OR a.group_name ILIKE $5)`;
  }
  const countResult = await pool.query(`
    SELECT COUNT(*)::int as count
    FROM admins a
    LEFT JOIN profiles p ON p.steamid = a.steamid
    ${where}
  `, params);
  const total = countResult.rows[0]?.count || 0;

  params.push(limit);
  params.push(offset);
  const result = await pool.query(`
    SELECT
      a.admin_id,
      a.steamid,
      a.group_display_name,
      a.group_name,
      a.immunity,
      a.is_frozen,
      COALESCE(p.name, (a.raw_json->>'name')) AS name,
      COALESCE(p.avatar_full, a.avatar_full) AS avatar_full,
      p.rank,
      p.kills,
      p.deaths,
      p.playtime,
      COALESCE(
        p.discord_nickname,
        p.raw_json->>'discordNickname',
        p.raw_json->>'discord_nickname',
        p.raw_json->'discord'->>'nickname',
        p.raw_json->'discord'->>'name'
      ) AS discord_nickname,
      COALESCE(
        p.discord_id,
        p.raw_json->>'providerUserId',
        p.raw_json->>'provider_user_id',
        p.raw_json->>'discordId',
        p.raw_json->>'discord_id',
        p.raw_json->'discord'->>'id',
        p.raw_json->'discord'->>'userId'
      ) AS discord_id,
      p.last_activity,
      p.ban_is_banned,
      p.vip_is_vip,
      (p.raw_json->>'created_at') AS fear_created_at,
      ((p.raw_json->'faceit')->>'level')::int AS faceit_level,
      (p.raw_json->'faceit')->>'url' AS faceit_url,
      ((p.raw_json->'faceit')->>'elo')::int AS faceit_elo,
      GREATEST(a.updated_at, COALESCE(p.updated_at, a.updated_at)) AS updated_at
    FROM admins a
    LEFT JOIN profiles p ON p.steamid = a.steamid
    ${where}
    ORDER BY a.admin_id DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  return { rows: result.rows, total };
}

async function listStaffWithServers(limit = 50, offset = 0, search = '', sortBy = 'admin_id', sortDir = 'DESC', staffOnly = false) {
  const params = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    where = `WHERE (COALESCE(p.name, a.raw_json->>'name') ILIKE $1
      OR a.steamid ILIKE $2
      OR COALESCE(p.discord_nickname, p.raw_json->>'discordNickname') ILIKE $3
      OR a.group_display_name ILIKE $4
      OR a.group_name ILIKE $5)`;
  }
  if (staffOnly) {
    const excluded = ['admin', 'admin+', 'ADMIN', 'ADMIN+', 'UNDEFINED', 'Медиа', 'MEDIA', 'МЕДИА'];
    const staffWhere = excluded.map((_, i) => {
      const idx = params.length + 1;
      params.push(excluded[i]);
      return `LOWER(COALESCE(a.group_name, '')) <> $${idx}`;
    }).join(' AND ');
    where = where ? where + ' AND ' + staffWhere : 'WHERE ' + staffWhere;
  }
  const countResult = await pool.query(`
    SELECT COUNT(*)::int as count
    FROM admins a
    LEFT JOIN profiles p ON p.steamid = a.steamid
    ${where}
  `, params);
  const total = countResult.rows[0]?.count || 0;

  const allowedSort = {
    'admin_id': 'a.admin_id',
    'name': 'COALESCE(p.name, a.raw_json->>\'name\')',
    'rank': 'p.rank',
    'kills': 'p.kills',
    'deaths': 'p.deaths',
    'playtime': 'p.playtime',
    'created_at': '(p.raw_json->>\'created_at\')',
    'faceit_elo': '((p.raw_json->\'faceit\')->>\'elo\')::int'
  };
  const orderCol = allowedSort[sortBy] || 'a.admin_id';
  const orderDir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  params.push(limit);
  params.push(offset);
  const result = await pool.query(`
    SELECT
      a.admin_id,
      a.steamid,
      a.group_display_name,
      a.group_name,
      a.immunity,
      a.is_frozen,
      COALESCE(p.name, (a.raw_json->>'name')) AS name,
      COALESCE(p.avatar_full, a.avatar_full) AS avatar_full,
      p.rank,
      p.kills,
      p.deaths,
      p.playtime,
      COALESCE(
        p.discord_nickname,
        p.raw_json->>'discordNickname',
        p.raw_json->>'discord_nickname',
        p.raw_json->'discord'->>'nickname',
        p.raw_json->'discord'->>'name'
      ) AS discord_nickname,
      COALESCE(
        p.discord_id,
        p.raw_json->>'providerUserId',
        p.raw_json->>'provider_user_id',
        p.raw_json->>'discordId',
        p.raw_json->>'discord_id',
        p.raw_json->'discord'->>'id',
        p.raw_json->'discord'->>'userId'
      ) AS discord_id,
      p.last_activity,
      p.ban_is_banned,
      p.vip_is_vip,
      (p.raw_json->>'created_at') AS fear_created_at,
      ((p.raw_json->'faceit')->>'level')::int AS faceit_level,
      (p.raw_json->'faceit')->>'url' AS faceit_url,
      ((p.raw_json->'faceit')->>'elo')::int AS faceit_elo,
      GREATEST(a.updated_at, COALESCE(p.updated_at, a.updated_at)) AS updated_at
    FROM admins a
    LEFT JOIN profiles p ON p.steamid = a.steamid
    ${where}
    ORDER BY ${orderCol} ${orderDir} NULLS LAST
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  return { rows: result.rows, total };
}

async function upsertPunishments(type, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  let upserted = 0;
  for (const row of rows) {
    try {
      await pool.query(
        `
        INSERT INTO punishments (
          id, type, steamid, name, admin, admin_steamid, admin_avatar, avatar,
          reason, status, duration, created, expires, unban_price, raw_json, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        ON CONFLICT (id) DO UPDATE SET
          type = EXCLUDED.type,
          steamid = EXCLUDED.steamid,
          name = EXCLUDED.name,
          admin = EXCLUDED.admin,
          admin_steamid = EXCLUDED.admin_steamid,
          admin_avatar = EXCLUDED.admin_avatar,
          avatar = EXCLUDED.avatar,
          reason = EXCLUDED.reason,
          status = EXCLUDED.status,
          duration = EXCLUDED.duration,
          created = EXCLUDED.created,
          expires = EXCLUDED.expires,
          unban_price = EXCLUDED.unban_price,
          raw_json = EXCLUDED.raw_json,
          updated_at = NOW()
        `,
        [
          row.id,
          type,
          row.steamid,
          row.name,
          row.admin,
          row.admin_steamid,
          row.admin_avatar || null,
          row.avatar || null,
          row.reason,
          row.status,
          row.duration,
          row.created,
          row.expires,
          row.unbanPrice || row.unban_price || null,
          JSON.stringify(row)
        ]
      );
      upserted++;
    } catch (error) {
      logger.error('Failed to upsert punishment', { id: row.id, error: error.message });
    }
  }
  return upserted;
}

async function getStaffPunishments(adminSteamid, type, limit = 100) {
  if (type && Number(type) > 0) {
    const result = await pool.query(
      `SELECT * FROM punishments WHERE admin_steamid = $1 AND type = $2 ORDER BY created DESC LIMIT $3`,
      [adminSteamid, type, limit]
    );
    return result.rows;
  }
  const result = await pool.query(
    `SELECT * FROM punishments WHERE admin_steamid = $1 ORDER BY created DESC LIMIT $2`,
    [adminSteamid, limit]
  );
  return result.rows;
}

async function getStaffPunishmentStats(adminSteamids) {
  if (!Array.isArray(adminSteamids) || adminSteamids.length === 0) return {};
  const result = await pool.query(
    `
    SELECT admin_steamid, type, COUNT(*)::int as count
    FROM punishments
    WHERE admin_steamid = ANY($1) AND status IN (1, 4)
    GROUP BY admin_steamid, type
    `,
    [adminSteamids]
  );
  const stats = {};
  for (const row of result.rows) {
    const sid = row.admin_steamid;
    if (!stats[sid]) stats[sid] = { bans: 0, mutes: 0 };
    if (Number(row.type) === 1) stats[sid].bans = row.count;
    if (Number(row.type) === 2) stats[sid].mutes = row.count;
  }
  return stats;
}

async function getPunishmentLogs(limit = 500, offset = 0, search = '') {
  const params = [];
  let where = 'WHERE admin_steamid IS NOT NULL AND admin_steamid != \'\'';
  if (search) {
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    where += ` AND (admin ILIKE $1 OR steamid ILIKE $2 OR name ILIKE $3 OR reason ILIKE $4)`;
  }
  params.push(limit, offset);
  const result = await pool.query(
    `SELECT id, type, steamid, name, admin, admin_steamid, reason, status, duration, created, expires
     FROM punishments
     ${where}
     ORDER BY created DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return result.rows;
}

async function getPunishmentLogsCount(search = '') {
  let where = 'WHERE admin_steamid IS NOT NULL AND admin_steamid != \'\'';
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    where += ` AND (admin ILIKE $1 OR steamid ILIKE $2 OR name ILIKE $3 OR reason ILIKE $4)`;
  }
  const result = await pool.query(
    `SELECT COUNT(*)::int as count FROM punishments ${where}`,
    params
  );
  return result.rows[0]?.count || 0;
}

async function getVdfHistory(limit = 100, offset = 0, search = '') {
  let query = `
    SELECT id, check_id, source, steamid, nickname,
           fear_banned, fear_reason, fear_unban_time,
           vac_banned, vac_days_ago, game_bans,
           yooma_banned, yooma_reason,
           admin_group, filename,
           attachment_url, message_url, created_at
    FROM vdf_history
  `;
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    query += ` WHERE steamid ILIKE $1 OR nickname ILIKE $2 OR fear_reason ILIKE $3`;
  }
  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);
  return result.rows;
}

async function getVdfHistoryCount(search = '') {
  let query = `SELECT COUNT(*)::int as count FROM vdf_history`;
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    query += ` WHERE steamid ILIKE $1 OR nickname ILIKE $2 OR fear_reason ILIKE $3`;
  }
  const result = await pool.query(query, params);
  return result.rows[0]?.count || 0;
}

async function getAllProfiles(limit = 50, offset = 0, search = '', sortBy = 'created_at', sortDir = 'DESC') {
  const params = [];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
    where = `WHERE (p.name ILIKE $1 OR p.steamid ILIKE $2 OR p.discord_nickname ILIKE $3)`;
  }
  const countResult = await pool.query(
    `SELECT COUNT(*)::int as count FROM profiles p ${where}`,
    params
  );
  const total = countResult.rows[0]?.count || 0;

  const allowedSort = {
    'created_at': "(p.raw_json->>'created_at')",
    'name': 'p.name',
    'kills': 'p.kills',
    'deaths': 'p.deaths',
    'playtime': 'p.playtime',
    'last_activity': 'p.last_activity'
  };
  const orderCol = allowedSort[sortBy] || "(p.raw_json->>'created_at')";
  const orderDir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  params.push(limit);
  params.push(offset);
  const result = await pool.query(`
    SELECT
      p.steamid, p.name, p.kills, p.deaths, p.playtime, p.rank,
      p.avatar_full, p.discord_nickname, p.discord_id,
      p.last_activity, p.ban_is_banned,
      (p.raw_json->>'created_at') AS fear_created_at,
      ((p.raw_json->'faceit')->>'level')::int AS faceit_level,
      (p.raw_json->'faceit')->>'url' AS faceit_url,
      ((p.raw_json->'faceit')->>'elo')::int AS faceit_elo,
      a.group_name, a.group_display_name
    FROM profiles p
    LEFT JOIN admins a ON a.steamid = p.steamid
    ${where}
    ORDER BY ${orderCol} ${orderDir} NULLS LAST
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  return { rows: result.rows, total };
}

async function getProfilesBySteamids(steamids) {
  if (!steamids || steamids.length === 0) return {};
  const result = await pool.query(`
    SELECT
      p.steamid,
      p.name,
      p.kills,
      p.deaths,
      p.playtime,
      p.rank,
      p.avatar_full,
      (p.raw_json->>'created_at') AS fear_created_at,
      ((p.raw_json->'faceit')->>'level')::int AS faceit_level,
      (p.raw_json->'faceit')->>'url' AS faceit_url,
      ((p.raw_json->'faceit')->>'elo')::int AS faceit_elo,
      a.group_name,
      a.group_display_name
    FROM profiles p
    LEFT JOIN admins a ON a.steamid = p.steamid
    WHERE p.steamid = ANY($1)
  `, [steamids]);
  const map = {};
  for (const row of result.rows) {
    map[row.steamid] = row;
  }
  return map;
}

const crypto = require("crypto");

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const result = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(result, "hex"), Buffer.from(hash, "hex"));
  } catch (_) {
    return false;
  }
}

async function findAdminByDiscordId(discordId) {
  if (!discordId) return null;
  const result = await pool.query(`
    SELECT a.steamid, a.group_name, a.group_display_name, a.immunity, a.admin_id,
           COALESCE(p.name, a.raw_json->>'name') AS name
    FROM admins a
    LEFT JOIN profiles p ON p.steamid = a.steamid
    WHERE COALESCE(
      p.discord_id,
      p.raw_json->>'providerUserId',
      p.raw_json->>'provider_user_id',
      p.raw_json->>'discordId',
      p.raw_json->>'discord_id',
      p.raw_json->'discord'->>'id',
      p.raw_json->'discord'->>'userId'
    ) = $1
    LIMIT 1
  `, [String(discordId)]);
  return result.rows[0] || null;
}

const STAFF_ROLE_RANK = {
  "Владелец": 15, "Куратор": 14, "Разработчик": 13,
  "Гл. Администратор": 12, "Ст. Администратор": 11, "Спец. Администратор": 10,
  "Ст. Модератор": 9, "Модератор": 8,
  "Мл. Модератор": 7, "Модератор Discord": 7, "Модератор месяца": 7,
  "Администратор": 6, "Администратор +": 6,
  "Стафф": 5,
};
const MIN_SITE_ROLE_RANK = 7;

function getSiteRoleRank(groupName) {
  return STAFF_ROLE_RANK[groupName] ?? 0;
}

async function createSiteUser(username, password, discordName, discordId, role, isActive = true) {
  const { hash, salt } = hashPassword(password);
  const result = await pool.query(
    `INSERT INTO site_users (username, password_hash, password_salt, discord_name, discord_id, role, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, role`,
    [username, hash, salt, discordName || null, discordId || null, role || 'user', isActive]
  );
  return result.rows[0];
}

async function getSiteUserByUsername(username) {
  const result = await pool.query(
    `SELECT * FROM site_users WHERE username = $1 AND is_active = TRUE`,
    [username]
  );
  return result.rows[0] || null;
}

async function getSiteUserByUsernameAny(username) {
  const result = await pool.query(
    `SELECT * FROM site_users WHERE username = $1`,
    [username]
  );
  return result.rows[0] || null;
}

async function activateSiteUser(userId) {
  await pool.query(`UPDATE site_users SET is_active = TRUE WHERE id = $1`, [userId]);
}

async function createRegistrationConfirmation(userId, discordId, confirmationCode, expiresAt) {
  await pool.query(
    `INSERT INTO panel_registration_confirmations (user_id, discord_id, confirmation_code, status, expires_at, created_at)
     VALUES ($1, $2, $3, 'pending', $4, $5)`,
    [userId, discordId || null, confirmationCode, expiresAt, Date.now()]
  );
}

async function getRegistrationConfirmation(code) {
  const result = await pool.query(
    `SELECT * FROM panel_registration_confirmations
     WHERE confirmation_code = $1 AND status = 'pending' AND expires_at > $2
     LIMIT 1`,
    [code, Date.now()]
  );
  return result.rows[0] || null;
}

async function getRegistrationConfirmationByUserId(userId) {
  const result = await pool.query(
    `SELECT * FROM panel_registration_confirmations
     WHERE user_id = $1 AND status = 'pending' AND expires_at > $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, Date.now()]
  );
  return result.rows[0] || null;
}

async function getSiteUserById(id) {
  const result = await pool.query(
    `SELECT id, username, discord_name, discord_id, role, created_at FROM site_users WHERE id = $1 AND is_active = TRUE`,
    [id]
  );
  return result.rows[0] || null;
}

async function loginSiteUser(username, password) {
  const user = await getSiteUserByUsername(username);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash, user.password_salt)) return null;
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO site_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`,
    [token, user.id, expiresAt]
  );
  return { token, user: { id: user.id, username: user.username, role: user.role } };
}

async function getSiteSession(token) {
  const result = await pool.query(
    `SELECT s.*, u.username, u.role, u.discord_name, u.discord_id
     FROM site_sessions s JOIN site_users u ON s.user_id = u.id
     WHERE s.token = $1 AND s.expires_at > NOW() AND u.is_active = TRUE`,
    [token]
  );
  return result.rows[0] || null;
}

async function deleteSiteSession(token) {
  await pool.query(`DELETE FROM site_sessions WHERE token = $1`, [token]);
}

async function logSiteLogin(userId, username, ipAddress, userAgent, action, details) {
  try {
    await pool.query(
      `INSERT INTO panel_login_logs (user_id, username, ip_address, user_agent, action, details) VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, username, ipAddress || null, userAgent || null, action || 'login', details || null]
    );
  } catch (_) {}
}

async function deleteSiteUser(userId) {
  await pool.query(`DELETE FROM site_sessions WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM site_users WHERE id = $1`, [userId]);
}

async function updateSiteUserRole(userId, role) {
  await pool.query(`UPDATE site_users SET role = $2 WHERE id = $1`, [userId, role]);
}

async function getHiddenStaff() {
  const result = await pool.query(`SELECT steamid, hidden_by, created_at FROM hidden_staff ORDER BY created_at DESC`);
  return result.rows;
}

async function addHiddenStaff(steamid, hiddenBy) {
  await pool.query(`INSERT INTO hidden_staff (steamid, hidden_by) VALUES ($1, $2) ON CONFLICT (steamid) DO NOTHING`, [steamid, hiddenBy]);
}

async function removeHiddenStaff(steamid) {
  await pool.query(`DELETE FROM hidden_staff WHERE steamid = $1`, [steamid]);
}

async function getOwners() {
  const result = await pool.query(`SELECT steamid, added_by, created_at FROM owners ORDER BY created_at DESC`);
  return result.rows;
}

async function addOwner(steamid, addedBy) {
  await pool.query(`INSERT INTO owners (steamid, added_by) VALUES ($1, $2) ON CONFLICT (steamid) DO NOTHING`, [steamid, addedBy]);
}

async function removeOwner(steamid) {
  await pool.query(`DELETE FROM owners WHERE steamid = $1`, [steamid]);
}

async function isOwner(steamid) {
  const result = await pool.query(`SELECT 1 FROM owners WHERE steamid = $1`, [steamid]);
  return result.rowCount > 0;
}

async function getReportsCount() {
  try {
    const cookie = process.env.FEAR_COOKIE || (process.env.ACCESS_TOKEN ? `access_token=${process.env.ACCESS_TOKEN}` : null);
    const headers = {
      'accept': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'origin': 'https://fearproject.ru',
      'referer': 'https://fearproject.ru/'
    };
    if (cookie) headers.cookie = cookie;
    const res = await fetch('https://fearproject.ru/api/reports/recent', {
      headers,
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const reports = Array.isArray(data) ? data : (data.reports || data.data || []);
    return reports.length;
  } catch (_) { return 0; }
}

async function getStaffStatsForPeriod(dateFrom, dateTo) {
  let dateWhere = "";
  const params = [];
  if (dateFrom) {
    params.push(Math.floor(dateFrom.getTime() / 1000));
    dateWhere += ` AND p.created >= $${params.length}`;
  }
  if (dateTo) {
    params.push(Math.floor(dateTo.getTime() / 1000));
    dateWhere += ` AND p.created <= $${params.length}`;
  }
  const result = await pool.query(`
    SELECT
      p.admin_steamid,
      p.admin,
      COALESCE(a.group_display_name, a.group_name, 'Стафф') AS role,
      a.group_name AS role_key,
      a.immunity,
      p.type,
      p.status,
      COUNT(*)::int as count
    FROM punishments p
    LEFT JOIN admins a ON a.steamid = p.admin_steamid
    WHERE p.admin_steamid IS NOT NULL AND p.admin_steamid != ''
    AND LOWER(COALESCE(a.group_name, 'staff')) NOT LIKE 'admin%'
    AND LOWER(COALESCE(a.group_name, 'staff')) NOT LIKE '%media%'
    ${dateWhere}
    GROUP BY p.admin_steamid, p.admin, a.group_display_name, a.group_name, a.immunity, p.type, p.status
  `, params);
  return result.rows;
}

async function getTabAccess() {
  try {
    const r = await pool.query(`SELECT tab_id, min_role_rank, enabled FROM tab_access ORDER BY id`);
    return r.rows;
  } catch (_) { return []; }
}

async function updateTabAccess(tabId, minRoleRank, enabled) {
  try {
    const r = await pool.query(
      `INSERT INTO tab_access (tab_id, min_role_rank, enabled, updated_at) VALUES ($3, $1, $2, NOW())
       ON CONFLICT (tab_id) DO UPDATE SET min_role_rank = $1, enabled = $2, updated_at = NOW()`,
      [minRoleRank, enabled, tabId]
    );
    return r.rowCount > 0;
  } catch (e) { console.error('updateTabAccess error:', e.message); return false; }
}

module.exports = {
  pool,
  initDb,
  createRefreshRun,
  finalizeRefreshRun,
  upsertAdmin,
  upsertProfile,
  listAdminsWithProfiles,
  upsertPunishments,
  getStaffPunishments,
  getStaffPunishmentStats,
  getVdfHistory,
  getVdfHistoryCount,
  listAdminsWithProfilesPaginated,
  listStaffWithServers,
  getProfilesBySteamids,
  createSiteUser,
  getSiteUserByUsername,
  getSiteUserById,
  loginSiteUser,
  getSiteSession,
  deleteSiteSession,
  logSiteLogin,
  deleteSiteUser,
  updateSiteUserRole,
  getStaffStatsForPeriod,
  findAdminByDiscordId,
  getSiteRoleRank,
  STAFF_ROLE_RANK,
  MIN_SITE_ROLE_RANK,
  getPunishmentLogs,
  getPunishmentLogsCount,
  getHiddenStaff,
  addHiddenStaff,
  removeHiddenStaff,
  getOwners,
  addOwner,
  removeOwner,
  isOwner,
  getReportsCount,
  getTabAccess,
  updateTabAccess,
  getAllProfiles,
  getSiteUserByUsernameAny,
  activateSiteUser,
  createRegistrationConfirmation,
  getRegistrationConfirmation,
  getRegistrationConfirmationByUserId
};
