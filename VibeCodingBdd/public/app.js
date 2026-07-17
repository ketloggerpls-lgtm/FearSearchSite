fetch("/api/auth/me").then(function(r) {
  if (r.status === 401) window.location.href = "/login";
}).catch(function() {});

var refreshBtn = document.getElementById("refreshBtn");
var statusEl = document.getElementById("status");
var allGridEl = document.getElementById("allGrid");
var paginationEl = document.getElementById("pagination");
var searchInput = document.getElementById("searchInput");
var onlineListEl = document.getElementById("onlineList");
var onlineCountEl = document.getElementById("onlineCount");
var allCountEl = document.getElementById("allCount");
var onlineStatusEl = document.getElementById("onlineStatus");

var PAGE_SIZE = 50;
var currentPage = 0;
var totalRows = 0;
var loading = false;
var searchTimeout = null;
var adminsLoaded = false;

function esc(s) { return String(s||"").replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]; }); }

function fmtHours(seconds) {
  if (seconds == null || seconds === 0) return null;
  var h = Number(seconds) / 3600;
  if (h >= 1) return h.toFixed(1) + "\u0447";
  return Math.round(Number(seconds) / 60) + "\u043c";
}

function toMs(v) {
  if (v == null) return null;
  var n = Number(v);
  if (isNaN(n)) return null;
  if (n < 1e12) return n * 1000;
  return n;
}

function fmtAge(created_at) {
  if (!created_at) return null;
  try {
    var ts = toMs(created_at);
    if (!ts) return null;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    var now = new Date();
    var diff = now - d;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return "\u0442\u043e\u043b\u044c\u043a\u043e \u0447\u0442\u043e";
    if (mins < 60) return mins + " \u043c. \u043d\u0430\u0437\u0430\u0434";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + " \u0447. \u043d\u0430\u0437\u0430\u0434";
    var days = Math.floor(hours / 24);
    if (days < 30) return days + " \u0434. \u043d\u0430\u0437\u0430\u0434";
    if (days < 365) return Math.floor(days / 30) + " \u043c. \u043d\u0430\u0437\u0430\u0434";
    return Math.floor(days / 365) + " \u0433. " + Math.floor((days % 365) / 30) + " \u043c.";
  } catch(e) { return null; }
}

function teamTag(team) {
  if (!team || team === "none" || team === "HIDE") return "";
  var t = team.toLowerCase();
  if (t === "ct") return '<span class="tag" style="background:rgba(59,130,246,0.15);color:#60a5fa;">ct</span>';
  if (t === "t") return '<span class="tag" style="background:rgba(245,158,11,0.15);color:#fbbf24;">t</span>';
  if (t === "spec") return '<span class="tag" style="background:rgba(168,85,247,0.15);color:#c084fc;">spec</span>';
  return '<span class="tag" style="background:rgba(107,114,128,0.15);color:#9ca3af;">' + esc(team) + '</span>';
}

function faceitBadge(level, elo) {
  if (level == null) return "";
  var cls = level >= 10 ? "faceit-lvl-10" : level >= 7 ? "faceit-lvl-7" : level >= 4 ? "faceit-lvl-4" : "text-gray-400";
  var txt = '<span class="' + cls + ' font-bold">' + level + '</span>';
  if (elo) txt += '<span class="text-gray-600 text-[10px] ml-0.5">' + elo + '</span>';
  return '<span class="tag" style="background:rgba(255,255,255,0.06);">' + txt + '</span>';
}

function roleColor(groupName) {
  var map = {
    "GLADMIN": "#f95dff", "\u0413\u043b. \u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440": "#f95dff",
    "STADMIN": "#22c7aa", "\u0421\u0442. \u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440": "#22c7aa", "\u0421\u0442. \u0410\u0434\u043c\u0438\u043d": "#22c7aa",
    "STMODER": "#8c56f0", "\u0421\u0442. \u041c\u043e\u0434\u0435\u0440\u0430\u0442\u043e\u0440": "#8c56f0",
    "MODER": "#e75288", "\u041c\u043e\u0434\u0435\u0440\u0430\u0442\u043e\u0440": "#e75288",
    "MLMODER": "#e2bb6d", "\u041c\u043b. \u041c\u043e\u0434\u0435\u0440\u0430\u0442\u043e\u0440": "#e2bb6d",
    "STAFF": "#eab308", "\u0421\u0442\u0430\u0444\u0444": "#eab308",
    "admin": "#6b7280", "\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440": "#6b7280",
    "admin+": "#9ca3af", "\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440 +": "#9ca3af",
    "\u0412\u043b\u0430\u0434\u0435\u043b\u0435\u0446": "#ff3c3c", "\u041a\u0443\u0440\u0430\u0442\u043e\u0440": "#ff8c00",
    "\u0420\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u0447\u0438\u043a": "#3a84c8",
    "\u0421\u043f\u0435\u0446. \u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440": "#d39ae1",
    "\u041c\u043e\u0434\u0435\u0440\u0430\u0442\u043e\u0440 Discord": "#bd458c",
    "\u041c\u043e\u0434\u0435\u0440\u0430\u0442\u043e\u0440 \u043c\u0435\u0441\u044f\u0446\u0430": "#da5f23"
  };
  return map[groupName] || "#6b7280";
}

function roleTag(groupName, groupDisplayName) {
  if (!groupName) return "";
  var label = groupDisplayName || groupName;
  var color = roleColor(groupName);
  return '<span class="tag" style="background:' + color + '18;color:' + color + ';">' + esc(label) + '</span>';
}

function copyToClipboard(text, el) {
  navigator.clipboard.writeText(text).then(function() {
    var orig = el.innerHTML;
    el.innerHTML = '<i class="ph ph-check text-emerald-400 text-xs"></i>';
    setTimeout(function() { el.innerHTML = orig; }, 1000);
  });
}

function renderCard(player) {
  var steamId = player.steam_id || player.steamid || "";
  var name = player.db_name || player.name || player.nickname || steamId;
  var avatar = player.db_avatar || player.avatar_full || player.avatar || "";
  var server = player._server || {};
  var serverName = server.site_name || server.domain || server.name || "";
  var mapName = server.live_data && server.live_data.map || server.map || "";
  var ip = server.ip || "";
  var port = server.port || "";
  var team = player.team || "";
  var kills = player.db_kills != null ? player.db_kills : (player.kills != null ? player.kills : null);
  var deaths = player.db_deaths != null ? player.db_deaths : (player.deaths != null ? player.deaths : null);
  var playtime = player.db_playtime || player.playtime || null;
  var faceitLevel = player.db_faceit_level != null ? player.db_faceit_level : player.faceit_level;
  var faceitElo = player.db_faceit_elo || player.faceit_elo;
  var groupName = player.group_name || "";
  var groupDisplay = player.group_display_name || groupName;
  var fearCreatedAt = player.db_fear_created_at || player.created_at;
  var ping = player.ping != null ? player.ping : null;
  var connectUrl = ip && port ? "steam://connect/" + ip + ":" + port : null;
  var steamUrl = "https://steamcommunity.com/profiles/" + steamId;
  var fearUrl = "https://fearproject.ru/profile/" + steamId;

  var kd = "-";
  if (kills != null && deaths != null && deaths > 0) kd = (kills / deaths).toFixed(1);
  else if (kills != null) kd = kills + "/0";

  var html = '<div class="admin-card rounded-xl bg-white/[0.03] p-3 flex flex-col gap-2 fade-in">';

  html += '<div class="flex items-start gap-2.5">';
  html += '<div class="relative shrink-0">';
  html += '<img src="' + esc(avatar) + '" alt="" class="w-10 h-10 rounded-lg object-cover">';
  html += '</div>';

  html += '<div class="flex-1 min-w-0">';
  html += '<div class="flex items-center gap-1.5 flex-wrap">';
  html += '<span class="text-sm font-semibold text-white truncate max-w-[160px]">' + esc(name) + '</span>';
  if (groupName) html += roleTag(groupName, groupDisplay);
  html += '</div>';
  html += '<div class="text-[11px] text-gray-500 font-mono mt-0.5">' + esc(steamId) + '</div>';
  html += '</div>';

  if (connectUrl) {
    html += '<a href="' + connectUrl + '" class="connect-btn shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1" title="\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c\u0441\u044f"><i class="ph ph-plugs text-xs"></i>Connect</a>';
  }
  html += '</div>';

  var meta = [];
  if (serverName) meta.push(esc(serverName));
  if (mapName) meta.push(esc(mapName));
  var playtimeStr = fmtHours(playtime);
  if (playtimeStr) meta.push(playtimeStr + " \u043d\u0430 \u0441\u0430\u0439\u0442\u0435");
  var ageStr = fmtAge(fearCreatedAt);
  if (ageStr) meta.push(ageStr);
  if (meta.length > 0) {
    html += '<div class="flex items-center gap-1.5 flex-wrap text-[11px] text-gray-500">';
    meta.forEach(function(item, i) {
      if (i > 0) html += '<span class="text-gray-700">\u00b7</span>';
      html += '<span>' + item + '</span>';
    });
    html += '</div>';
  }

  html += '<div class="flex items-center justify-between">';
  html += '<div class="flex items-center gap-1.5 flex-wrap">';
  if (kills != null || deaths != null) {
    html += '<span class="tag" style="background:rgba(255,255,255,0.06);"><span class="text-gray-400 text-[10px]">K/D</span> <span class="text-white font-semibold">' + kd + '</span></span>';
  }
  if (faceitLevel != null) html += faceitBadge(faceitLevel, faceitElo);
  if (ping != null) html += '<span class="tag" style="background:rgba(255,255,255,0.06);"><span class="text-gray-400 text-[10px]">PING</span> <span class="text-white font-semibold">' + ping + 'ms</span></span>';
  html += '</div>';

  html += '<div class="flex items-center gap-1">';
  html += '<a href="' + fearUrl + '" target="_blank" class="p-1 rounded hover:bg-white/10 transition-colors" title="Fear Profile"><i class="ph ph-user text-gray-500 hover:text-white text-xs"></i></a>';
  html += '<a href="' + steamUrl + '" target="_blank" class="p-1 rounded hover:bg-white/10 transition-colors" title="Steam Profile"><i class="ph ph-steam-logo text-gray-500 hover:text-white text-xs"></i></a>';
  html += '<button onclick="copyToClipboard(\'' + esc(steamId) + '\', this)" class="p-1 rounded hover:bg-white/10 transition-colors" title="SteamID"><i class="ph ph-copy text-gray-500 hover:text-white text-xs"></i></button>';
  if (ip && port) {
    html += '<button onclick="copyToClipboard(\'' + esc(ip + ':' + port) + '\', this)" class="p-1 rounded hover:bg-white/10 transition-colors" title="IP:PORT"><i class="ph ph-link text-gray-500 hover:text-white text-xs"></i></button>';
  }
  html += '</div>';
  html += '</div>';
  html += '</div>';
  return html;
}

function renderOnlineRow(p) {
  var steamId = p.steam_id || "";
  var name = p.db_name || p.nickname || steamId;
  var avatar = p.db_avatar || p.avatar || "";
  var server = p._server || {};
  var serverLabel = server.site_name || server.domain || "";
  var mapName = server.live_data && server.live_data.map || server.map || "";
  var team = p.team || "";
  var playtime = p.db_playtime;
  var faceitLevel = p.db_faceit_level;
  var connectUrl = "steam://connect/" + server.ip + ":" + server.port;
  var steamUrl = "https://steamcommunity.com/profiles/" + steamId;
  var fearUrl = "https://fearproject.ru/profile/" + steamId;

  var html = '<div class="flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10 online-card">';
  html += '<img src="' + esc(avatar) + '" alt="" class="w-8 h-8 rounded-full shrink-0">';
  html += '<div class="flex-1 min-w-0">';
  html += '<div class="flex items-center gap-2">';
  html += '<span class="text-sm text-emerald-300 font-medium truncate">' + esc(name) + '</span>';
  html += teamTag(team);
  html += '</div>';
  html += '<div class="flex items-center gap-1.5 text-[11px] text-gray-500">';
  if (serverLabel) html += '<span>' + esc(serverLabel) + '</span>';
  if (mapName) html += '<span>\u00b7 ' + esc(mapName) + '</span>';
  var playtimeStr = fmtHours(playtime);
  if (playtimeStr) html += '<span>\u00b7 ' + playtimeStr + '</span>';
  if (faceitLevel != null) html += '<span>\u00b7 Faceit LVL ' + faceitLevel + '</span>';
  html += '</div></div>';
  html += '<a href="' + connectUrl + '" class="shrink-0 px-2 py-1 rounded bg-[#5865F2]/20 hover:bg-[#5865F2]/40 text-[#5865F2] text-xs font-medium transition-colors flex items-center gap-1" title="\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c\u0441\u044f"><i class="ph ph-plugs"></i> Connect</a>';
  html += '<a href="' + fearUrl + '" target="_blank" class="shrink-0 p-1 rounded hover:bg-white/10 transition-colors" title="Fear"><i class="ph ph-user text-gray-400 hover:text-white text-sm"></i></a>';
  html += '<a href="' + steamUrl + '" target="_blank" class="shrink-0 p-1 rounded hover:bg-white/10 transition-colors" title="Steam"><i class="ph ph-steam-logo text-gray-400 hover:text-white text-sm"></i></a>';
  html += '<button onclick="copyToClipboard(\'' + esc(steamId) + '\', this)" class="shrink-0 p-1 rounded hover:bg-white/10 transition-colors" title="SteamID"><i class="ph ph-copy text-gray-400 hover:text-white text-sm"></i></button>';
  html += '</div>';
  return html;
}

function clearAllCards() {
  allGridEl.innerHTML = '<div class="col-span-full text-center py-6 text-gray-500 text-xs">\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...</div>';
  currentPage = 0;
  totalRows = 0;
}

async function loadPage(reset) {
  if (loading) return;
  if (!reset && currentPage * PAGE_SIZE >= totalRows && totalRows > 0) return;
  loading = true;

  if (reset) clearAllCards();

  var search = searchInput ? searchInput.value.trim() : "";
  var offset = reset ? 0 : currentPage * PAGE_SIZE;
  var url = "/api/admins?limit=" + PAGE_SIZE + "&offset=" + offset + "&sortBy=admin_id&sortDir=DESC" + (search ? "&search=" + encodeURIComponent(search) : "");

  try {
    var res = await fetch(url);
    var data = await res.json();
    totalRows = data.total || 0;
    var rows = data.rows || [];

    if (reset) allGridEl.innerHTML = '';

    var html = '';
    rows.forEach(function(row) { html += renderCard(row); });
    allGridEl.insertAdjacentHTML('beforeend', html);

    currentPage++;
    if (paginationEl) paginationEl.textContent = "\u041f\u043e\u043a\u0430\u0437\u0430\u043d\u043e " + Math.min(currentPage * PAGE_SIZE, totalRows) + " \u0438\u0437 " + totalRows;
    if (allCountEl) allCountEl.textContent = "(" + totalRows + ")";
  } catch (error) {
    if (paginationEl) paginationEl.textContent = "\u041e\u0448\u0438\u0431\u043a\u0430: " + error.message;
  } finally {
    loading = false;
  }
}

var observer = new IntersectionObserver(function(entries) {
  entries.forEach(function(entry) {
    if (entry.isIntersecting && !loading) loadPage(false);
  });
}, { rootMargin: "300px" });

var sentinel = document.createElement("div");
sentinel.id = "scrollSentinel";
sentinel.className = "h-1";
allGridEl.parentElement.appendChild(sentinel);
observer.observe(sentinel);

if (searchInput) {
  searchInput.addEventListener("input", function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function() { loadPage(true); }, 300);
  });
}

document.querySelectorAll(".tab-btn").forEach(function(btn) {
  btn.addEventListener("click", function() {
    document.querySelectorAll(".tab-btn").forEach(function(b) { b.classList.remove("active"); });
    document.querySelectorAll(".tab-content").forEach(function(c) { c.classList.remove("active"); });
    btn.classList.add("active");
    var tab = document.getElementById("tab-" + btn.dataset.tab);
    if (tab) tab.classList.add("active");
    if (btn.dataset.tab === "all" && !adminsLoaded) {
      adminsLoaded = true;
      loadPage(true);
    }
  });
});

async function loadOnlineAdmins() {
  try {
    if (onlineStatusEl) onlineStatusEl.textContent = "\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...";
    var res = await fetch("/api/servers");
    var data = await res.json();
    var servers = data.servers || [];

    var allPlayers = [];
    servers.forEach(function(s) {
      (s.live_data && s.live_data.players || []).forEach(function(p) {
        if (p.is_admin) {
          p._server = s;
          allPlayers.push(p);
        }
      });
    });

    var seen = {};
    var unique = allPlayers.filter(function(p) {
      if (seen[p.steam_id]) return false;
      seen[p.steam_id] = true;
      return true;
    });

    if (onlineCountEl) onlineCountEl.textContent = "(" + unique.length + ")";
    if (onlineStatusEl) onlineStatusEl.textContent = "";

    if (unique.length === 0) {
      onlineListEl.innerHTML = '<span class="text-gray-500 text-sm">\u041d\u0438\u043a\u043e\u0433\u043e \u043d\u0435\u0442 \u043e\u043d\u043b\u0430\u0439\u043d</span>';
      return;
    }

    var html = unique.map(function(p) { return renderOnlineRow(p); }).join("");
    onlineListEl.innerHTML = html;
  } catch (error) {
    onlineListEl.innerHTML = '<span class="text-gray-500 text-sm">\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c</span>';
  }
}

if (refreshBtn) {
  refreshBtn.addEventListener("click", async function() {
    try {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<i class="ph ph-arrows-clockwise animate-spin"></i> \u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435...';
      var response = await fetch("/api/refresh", { method: "POST" });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || "\u041e\u0448\u0438\u0431\u043a\u0430");
      setTimeout(function() { loadOnlineAdmins(); }, 3000);
    } catch (error) {
      alert(error.message);
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="ph ph-arrows-clockwise"></i> \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c';
    }
  });
}

var logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async function() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  });
}

setInterval(loadOnlineAdmins, 15000);
loadOnlineAdmins();
