const logger = require('./logger');
const { fetchAdmins, fetchStaffPunishments, fetchStaffPunishmentsFromDavidonchik } = require('./fearApi');
const { upsertPunishments } = require('./db');

const STAFF_STATS_STEAM_IDS = (process.env.STAFF_STATS_STEAM_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const REFRESH_HOURS = Number(process.env.STAFF_PUNISHMENTS_REFRESH_HOURS || '1');
const REFRESH_MS = REFRESH_HOURS * 60 * 60 * 1000;
const PAGE_LIMIT = 100;
const REQUEST_DELAY_MS = Number(process.env.STAFF_SYNC_REQUEST_DELAY_MS || '8000');
const CONCURRENCY = 1;

const EXCLUDED_ROLE_KEYS = new Set(['admin', 'admin+', 'ADMIN', 'ADMIN+', 'UNDEFINED', 'Медиа', 'MEDIA']);

function isStaffAdmin(admin) {
  const groupDisplay = String(admin?.group_display_name || '').trim();
  const groupName = String(admin?.group_name || '').trim().toUpperCase();
  if (EXCLUDED_ROLE_KEYS.has(groupName)) return false;
  if (EXCLUDED_ROLE_KEYS.has(groupDisplay)) return false;
  if (!groupDisplay && !groupName) return false;
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncPunishmentsForStaff(steamid) {
  logger.info('Syncing punishments for staff', { steamid });
  for (const urlType of [1, 2]) {
    try {
      const data = await fetchStaffPunishmentsFromDavidonchik(steamid, urlType);
      if (data.punishments.length > 0) {
        await upsertPunishments(urlType, data.punishments);
        logger.info('Davidonchik sync OK', { steamid, type: urlType, count: data.punishments.length });
      } else {
        logger.debug('Davidonchik returned 0 punishments', { steamid, type: urlType });
      }
      if (urlType === 1) await sleep(1000);
      continue;
    } catch (error) {
      logger.warn('Davidonchik failed, falling back to Fear API', { steamid, type: urlType, error: error.message });
    }

    let page = 1;
    while (true) {
      try {
        const data = await fetchStaffPunishments(steamid, urlType, page, PAGE_LIMIT);
        if (!data || !Array.isArray(data.punishments) || data.punishments.length === 0) break;
        const rows = data.punishments.filter(r => String(r.admin_steamid) === String(steamid));
        if (rows.length > 0) {
          await upsertPunishments(urlType, rows);
          logger.debug('Fear API upserted page', { steamid, type: urlType, page, count: rows.length });
        }
        if (data.punishments.length < PAGE_LIMIT) break;
        page++;
        await sleep(REQUEST_DELAY_MS);
      } catch (error) {
        logger.error('Fear API fallback failed', { steamid, type: urlType, page, error: error.message });
        if (error.message && error.message.includes('429')) {
          const backoff = Math.min(REQUEST_DELAY_MS * 8, 60000);
          logger.warn('429 hit, backing off', { steamid, backoff });
          await sleep(backoff);
        }
        break;
      }
    }
    if (urlType === 1) await sleep(REQUEST_DELAY_MS);
  }
}

async function getStaffSteamIds() {
  // Prefer explicit env override
  if (STAFF_STATS_STEAM_IDS.length > 0) {
    return STAFF_STATS_STEAM_IDS;
  }
  try {
    const admins = await fetchAdmins();
    if (!Array.isArray(admins)) {
      logger.warn('fetchAdmins returned non-array');
      return [];
    }
    const staff = admins.filter(isStaffAdmin);
    logger.info('Fetched staff list from API', { total: admins.length, staff: staff.length });
    return staff.map((a) => String(a?.steamid || '')).filter(Boolean);
  } catch (error) {
    logger.error('Failed to fetch staff list', { error: error.message });
    return [];
  }
}

async function syncAllStaffPunishments() {
  const steamIds = await getStaffSteamIds();
  if (steamIds.length === 0) {
    logger.info('No staff steamids found, skipping punishments sync');
    return;
  }
  logger.info('Starting staff punishments sync', {
    count: steamIds.length,
  });
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, steamIds.length) },
    async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= steamIds.length) return;
        const steamid = steamIds[idx];
        await syncPunishmentsForStaff(steamid);
        if (idx < steamIds.length - 1) {
          await sleep(REQUEST_DELAY_MS);
        }
      }
    }
  );
  await Promise.all(workers);
  logger.info('Finished staff punishments sync');
}

function startStaffPunishmentsSync() {
  logger.info('Staff punishments auto-sync scheduled', {
    everyHours: REFRESH_HOURS,
  });
  syncAllStaffPunishments().catch((err) =>
    logger.error('Initial staff punishments sync failed', { error: err.message })
  );
  setInterval(() => {
    syncAllStaffPunishments().catch((err) =>
      logger.error('Scheduled staff punishments sync failed', { error: err.message })
    );
  }, REFRESH_MS);
}

module.exports = {
  syncAllStaffPunishments,
  startStaffPunishmentsSync,
};
