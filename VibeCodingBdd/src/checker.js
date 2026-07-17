'use strict';

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const url = require('url');
const querystring = require('querystring');
const { pool } = require('./db');
const { fearApiGet, sleepMs } = require('./fearApi');

const STEAM_API_KEY = process.env.STEAM_API_KEY || '';
const FEAR_API_BASE = process.env.FEAR_API_BASE || 'https://fearproject.ru/api';
const FEAR_API_BASE_OLD = process.env.FEAR_API_BASE_OLD || 'https://api.fearproject.ru';
const YOOMA_API = 'https://yooma.su/api/public/read/punishments';

const CACHE_TTL = 5 * 60 * 1000;
const _fearCache = new Map();
const _yoomaCache = new Map();

const FEAR_SEM = { limit: 5, running: 0, queue: [] };
const YOOMA_SEM = { limit: 5, running: 0, queue: [] };

function getJson(urlStr, options = {}) {
    return new Promise((resolve, reject) => {
        const parsed = url.parse(urlStr);
        const client = parsed.protocol === 'https:' ? https : http;
        const req = client.request({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + (parsed.search || ''),
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 10000
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = body ? JSON.parse(body) : null;
                    resolve({ status: res.statusCode, data, body });
                } catch (e) {
                    resolve({ status: res.statusCode, data: null, body });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
    });
}

function parseVdfSteamids(text) {
    if (!text) return [];
    let found = [];
    const m1 = text.match(/"SteamID"\s+"(7656\d{13})"/gi);
    if (m1) found = m1.map(s => s.match(/"(7656\d{13})"/i)[1]);
    if (found.length === 0) {
        const m2 = text.match(/"(steamid|steam_id|steamId)"\s+"(7656\d{13})"/gi);
        if (m2) found = m2.map(s => s.match(/"(7656\d{13})"/i)[1]);
    }
    if (found.length === 0) {
        const m3 = text.match(/"(7656119\d{10})"/g);
        if (m3) found = m3.map(s => s.replace(/"/g, ''));
    }
    if (found.length === 0) {
        const m4 = text.match(/(7656119\d{10})/g);
        if (m4) found = m4;
    }
    if (found.length === 0) {
        const m5 = text.match(/(7656\d{13})/g);
        if (m5) found = m5;
    }
    return Array.from(new Set(found));
}

function fearAuthHeaders() {
    const h = {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
    };
    const token = process.env.FEAR_ACCESS_TOKEN || process.env.ACCESS_TOKEN || '';
    if (token) h.Cookie = `access_token=${token}`;
    return h;
}

async function acquire(sem, fn) {
    if (sem.running < sem.limit) {
        sem.running++;
        try { return await fn(); } finally {
            sem.running--;
            if (sem.queue.length > 0) sem.queue.shift()();
        }
    }
    return new Promise(resolve => { sem.queue.push(() => acquire(sem, fn).then(resolve)); });
}

async function checkFear(steamid) {
    const cached = _fearCache.get(steamid);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
    try {
        const res = await getJson(`${FEAR_API_BASE}/profile/${steamid}`, { headers: fearAuthHeaders(), timeout: 5000 });
        if (res.status === 200 && res.data) { _fearCache.set(steamid, { data: res.data, ts: Date.now() }); return res.data; }
    } catch (_) {}
    try {
        const res = await getJson(`${FEAR_API_BASE_OLD}/profile/${steamid}`, { headers: fearAuthHeaders(), timeout: 5000 });
        if (res.status === 200 && res.data) { _fearCache.set(steamid, { data: res.data, ts: Date.now() }); return res.data; }
    } catch (_) {}
    return null;
}

async function checkFearBan(steamid) {
    const cached = _fearCache.get('ban_' + steamid);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
    try {
        const res = await getJson(`${FEAR_API_BASE}/bans/check/${steamid}`, { headers: fearAuthHeaders(), timeout: 5000 });
        if (res.status === 200 && res.data) { _fearCache.set('ban_' + steamid, { data: res.data, ts: Date.now() }); return res.data; }
    } catch (_) {}
    try {
        const res = await getJson(`${FEAR_API_BASE_OLD}/bans/check/${steamid}`, { headers: fearAuthHeaders(), timeout: 5000 });
        if (res.status === 200 && res.data) { _fearCache.set('ban_' + steamid, { data: res.data, ts: Date.now() }); return res.data; }
    } catch (_) {}
    return null;
}

async function checkFearPunishments(steamid) {
    const result = [];
    for (let page = 1; page <= 5; page++) {
        const qs = querystring.stringify({ q: steamid, type: 1, page, limit: 20 });
        try {
            const res = await getJson(`${FEAR_API_BASE}/punishments/search?${qs}`, { headers: fearAuthHeaders(), timeout: 5000 });
            if (res.status !== 200 || !res.data || !Array.isArray(res.data.punishments)) break;
            for (const p of res.data.punishments) {
                if (String(p.steamid || '').trim() === String(steamid)) result.push(p);
            }
            if (res.data.punishments.length < 20) break;
        } catch (_) { break; }
        await sleepMs(300);
    }
    return result;
}

async function checkYooma(steamid) {
    const cached = _yoomaCache.get(steamid);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
    const qs = querystring.stringify({ punish_type: 0, search: steamid, page: 1, mobile: 1 });
    try {
        const res = await getJson(YOOMA_API + '?' + qs, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://yooma.su/', 'Origin': 'https://yooma.su' },
            timeout: 5000
        });
        if (res.status !== 200 || !res.data || !res.data.ok) { _yoomaCache.set(steamid, { data: { found: false, punishments: [] }, ts: Date.now() }); return { found: false, punishments: [] }; }
        const nowTs = Math.floor(Date.now() / 1000);
        const processed = (res.data.punishments || []).filter(p => String(p.steamid || '').trim() === String(steamid)).map(p => {
            const unpunishId = p.unpunish_admin_id;
            let status = 'active';
            if (unpunishId != null && unpunishId !== 0) status = 'unbanned';
            else if (p.expires > 0 && p.expires < nowTs) status = 'expired';
            return { ...p, status };
        });
        const result = { found: processed.length > 0, punishments: processed };
        _yoomaCache.set(steamid, { data: result, ts: Date.now() });
        return result;
    } catch (_) {
        _yoomaCache.set(steamid, { data: { found: false, punishments: [] }, ts: Date.now() });
        return { found: false, punishments: [] };
    }
}

async function checkAccounts(steamids) {
    const uniqueIds = Array.from(new Set(steamids));
    const bansMap = {};
    const summariesMap = {};
    for (let i = 0; i < uniqueIds.length; i += 100) {
        const batch = uniqueIds.slice(i, i + 100);
        const idsStr = batch.join(',');
        const qs = querystring.stringify({ key: STEAM_API_KEY, steamids: idsStr });
        try {
            const [bansRes, sumRes] = await Promise.all([
                getJson(`https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?${qs}`, { timeout: 8000 }),
                getJson(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?${qs}`, { timeout: 8000 })
            ]);
            if (bansRes.status === 200 && bansRes.data?.players) for (const p of bansRes.data.players) { const sid = p.SteamId || p.SteamID; if (sid) bansMap[sid] = p; }
            if (sumRes.status === 200 && sumRes.data?.response?.players) for (const p of sumRes.data.response.players) summariesMap[p.steamid] = p;
        } catch (_) {}
    }

    const checkOne = async (sid) => {
        const [fear, fearBan, fearPunishments, yooma] = await Promise.all([
            acquire(FEAR_SEM, () => checkFear(sid)),
            acquire(FEAR_SEM, () => checkFearBan(sid)),
            acquire(FEAR_SEM, () => checkFearPunishments(sid)),
            acquire(YOOMA_SEM, () => checkYooma(sid))
        ]);
        const steamBan = bansMap[sid] || {};
        const summary = summariesMap[sid] || {};
        const validBans = Array.isArray(fearPunishments) ? fearPunishments.filter(p => Number(p.status || -1) === 1) : [];
        let banInfo = {};
        if (validBans.length > 0) {
            const p = validBans[0];
            banInfo = { isBanned: true, reason: p.reason || p.ban_reason || '', unbanTimestamp: p.expires || null };
        } else {
            const checkBanInfo = fearBan || {};
            if (checkBanInfo.isBanned || checkBanInfo.is_banned || checkBanInfo.banned) banInfo = checkBanInfo;
            else if (fear?.banInfo?.isBanned) banInfo = fear.banInfo;
        }
        let adminGroup = '';
        if (fear) {
            if (fear.adminGroup?.group_name) adminGroup = fear.adminGroup.group_name;
            else if (fear.rank_name) adminGroup = fear.rank_name;
            else if (fear.rank) adminGroup = String(fear.rank);
            if (!adminGroup || /^\d+$/.test(adminGroup)) adminGroup = '';
        }
        return {
            steamid: sid,
            nickname: fear?.name || summary.personaname || sid,
            avatar: summary.avatarfull || '',
            fear_banned: Boolean(banInfo.isBanned || banInfo.is_banned || banInfo.banned),
            fear_reason: banInfo.reason || '',
            fear_unban_ts: banInfo.unbanTimestamp || null,
            vac_banned: Boolean(steamBan.VACBanned),
            vac_days: steamBan.DaysSinceLastBan || 0,
            game_bans: steamBan.NumberOfGameBans || 0,
            yooma_data: yooma,
            admin_group: adminGroup
        };
    };

    return await Promise.all(uniqueIds.map(checkOne));
}

function toFrontend(r) {
    const yoomaData = r.yooma_data || {};
    const active = (yoomaData.punishments || []).filter(p => p.status === 'active');
    return {
        steamid: r.steamid, nickname: r.nickname, avatar: r.avatar,
        fearBanned: r.fear_banned, fearReason: r.fear_reason, fearUnban: r.fear_unban_ts,
        vacBanned: r.vac_banned, vacDays: r.vac_days, gameBans: r.game_bans,
        yoomaFound: yoomaData.found, yoomaBans: active.map(p => ({ reason: p.reason || '—', admin: p.admin_name || '—', created: p.created, expires: p.expires })),
        adminGroup: r.admin_group
    };
}

async function saveVdfHistory(results, filename, vdfText) {
    try {
        for (const r of results) {
            await pool.query(
                `INSERT INTO vdf_history (source, steamid, nickname, fear_banned, fear_reason, fear_unban_time, vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason, admin_group, filename, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
                ['site', r.steamid, r.nickname, r.fear_banned, r.fear_reason, r.fear_unban_ts, r.vac_banned, r.vac_days, r.game_bans,
                 Boolean(r.yooma_data?.found), (r.yooma_data?.punishments?.[0]?.reason || ''), r.admin_group, filename || '']
            );
        }
        return true;
    } catch (e) {
        console.error('[Checker] saveVdfHistory error:', e.message);
        return null;
    }
}

function parseMultipartFiles(buffer, contentType) {
    const boundaryMatch = contentType.match(/boundary=([^;\s]+)/);
    if (!boundaryMatch) return [];
    const boundary = Buffer.from('--' + boundaryMatch[1].replace(/^"|"$/g, ''), 'ascii');
    const files = [];
    let start = 0;
    while (true) {
        const idx = buffer.indexOf(boundary, start);
        if (idx === -1) break;
        let partStart = idx + boundary.length;
        if (start > 0) {
            let part = buffer.slice(start, idx);
            if (part.length >= 2 && part.slice(0, 2).toString('hex') === '0d0a') part = part.slice(2);
            if (part.length >= 2) {
                const last2 = part.slice(part.length - 2).toString('hex');
                if (last2 === '0d0a') part = part.slice(0, part.length - 2);
                else if (last2 === '2d2d') part = part.slice(0, part.length - 2);
            }
            const headerEnd = part.indexOf('\r\n\r\n');
            const splitAt = headerEnd !== -1 ? headerEnd + 4 : -1;
            if (splitAt > 0) {
                const headers = part.slice(0, splitAt).toString('utf8');
                const content = part.slice(splitAt);
                const cdMatch = headers.match(/Content-Disposition:\s*form-data;\s*name="[^"]*";\s*filename="([^"]+)"/i);
                if (cdMatch) files.push({ filename: cdMatch[1], content });
            }
        }
        if (partStart >= buffer.length) break;
        const tail = buffer.slice(partStart, Math.min(partStart + 4, buffer.length));
        if (tail.toString('ascii') === '--\r\n' || tail.toString('ascii') === '--') break;
        start = partStart;
    }
    return files;
}

async function handleCheckerApi(req, res, rawUrlPath) {
    if (rawUrlPath === '/checker/api/check-vdf' && req.method === 'POST') {
        let body;
        if (Buffer.isBuffer(req.body)) {
            body = req.body;
        } else {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            body = Buffer.concat(chunks);
        }
        const ct = req.headers['content-type'] || '';
        const files = parseMultipartFiles(body, ct);
        let allIds = [];
        let vdfText = '';
        let filename = '';
        for (const file of files) {
            if (!file.filename?.toLowerCase().endsWith('.vdf')) continue;
            if (!filename) filename = file.filename;
            const text = file.content.toString('utf8');
            vdfText += '\n' + text;
            allIds.push(...parseVdfSteamids(text));
        }
        if (allIds.length === 0 && vdfText) {
            allIds.push(...parseVdfSteamids(vdfText));
        }
        const ids = Array.from(new Set(allIds));
        if (ids.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ detail: 'SteamID не найдены в файле' }));
            return;
        }
        const results = await checkAccounts(ids);
        const checkId = await saveVdfHistory(results, filename, vdfText);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results: results.map(toFrontend), total: results.length, check_id: checkId, saved: Boolean(checkId) }));
        return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Not Found' }));
}

module.exports = { handleCheckerApi, parseVdfSteamids, checkAccounts };
