fetch("/api/auth/me").then(function(r) {
  if (r.status === 401) window.location.href = "/login";
}).catch(function() {});

var refreshBtn = document.getElementById("refreshBtn");
var statusEl = document.getElementById("status");
var rowsEl = document.getElementById("rows");
var paginationEl = document.getElementById("pagination");
var searchInput = document.getElementById("searchInput");
var onlineGridEl = document.getElementById("onlineGrid");
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
  if (seconds == null || seconds === 0) return "-";
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
    if (diff < 0) return "\u0442\u043e\u043b\u044c\u043a\u043e \u0447\u0442\u043e";
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

function fmtDate(value) {
  if (!value) return "-";
  try { return new Date(value).toLocaleString("ru-RU"); } catch(e) { return "-"; }
}

function teamTag(team) {
  if (!team) return "";
  var t = team.toLowerCase();
  if (t === "none" || t === "hide" || t === "spec") return "";
  if (t === "ct") return '<span class="tag" style="background:rgba(59,130,246,0.15);color:#60a5fa;">ct</span>';
  if (t === "t") return '<span class="tag" style="background:rgba(245,158,11,0.15);color:#fbbf24;">t</span>';
  return '<span class="tag" style="background:rgba(107,114,128,0.15);color:#9ca3af;">' + esc(team) + '</span>';
}

function faceitBadge(level, elo) {
  if (level == null) return '<span class="text-gray-600">-</span>';
  var cls = level >= 10 ? "text-orange-400" : level >= 7 ? "text-purple-400" : level >= 4 ? "text-blue-400" : "text-gray-400";
  var html = '<span class="' + cls + ' font-semibold">LVL ' + level + '</span>';
  if (elo) html += '<span class="text-gray-600 text-xs ml-1">(' + elo + ')</span>';
  return html;
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

// ===================== ONLINE CARDS =====================
function renderOnlineCard(p) {
  var steamId = p.steam_id || "";
  var name = p.db_name || p.nickname || steamId;
  var avatar = p.db_avatar || p.avatar || "";
  var server = p._server || {};
  var serverName = server.site_name || server.domain || server.name || "";
  var mapName = server.live_data && server.live_data.map || server.map || "";
  var ip = server.ip || "";
  var port = server.port || "";
  var team = p.team || "";
  var playtime = p.db_playtime;
  var faceitLevel = p.db_faceit_level;
  var faceitElo = p.db_faceit_elo;
  var fearCreatedAt = p.db_fear_created_at || p.created_at;
  var connectUrl = "steam://connect/" + ip + ":" + port;
  var steamUrl = "https://steamcommunity.com/profiles/" + steamId;
  var fearUrl = "https://fearproject.ru/profile/" + steamId;

  var html = '<div class="admin-card online rounded-xl bg-white/[0.03] p-3 flex flex-col gap-2 fade-in">';
  html += '<div class="flex items-start gap-2.5">';
  html += '<div class="relative shrink-0">';
  html += '<img src="' + esc(avatar) + '" alt="" class="w-10 h-10 rounded-lg object-cover">';
  html += '<div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0a0a0c]"></div>';
  html += '</div>';
  html += '<div class="flex-1 min-w-0">';
  html += '<div class="flex items-center gap-1.5 flex-wrap">';
  html += '<span class="text-sm font-semibold text-white truncate max-w-[160px]">' + esc(name) + '</span>';
  html += teamTag(team);
  html += '</div>';
  html += '<div class="text-[11px] text-gray-500 font-mono mt-0.5">' + esc(steamId) + '</div>';
  html += '</div>';
  html += '<a href="' + connectUrl + '" class="connect-btn shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1"><i class="ph ph-plugs text-xs"></i>Connect</a>';
  html += '</div>';

  var meta = [];
  if (serverName) meta.push(esc(serverName));
  if (mapName) meta.push(esc(mapName));
  var playtimeStr = fmtHours(playtime);
  if (playtimeStr && playtimeStr !== "-") meta.push(playtimeStr + " \u043d\u0430 \u0441\u0430\u0439\u0442\u0435");
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
  html += '<div class="flex items-center gap-1.5">';
  if (faceitLevel != null) html += '<span class="tag" style="background:rgba(255,255,255,0.06);"><span class="text-gray-400 text-[10px]">Faceit</span> ' + faceitBadge(faceitLevel, faceitElo) + '</span>';
  html += '</div>';
  html += '<div class="flex items-center gap-1">';
  html += '<a href="' + fearUrl + '" target="_blank" class="p-1 rounded hover:bg-white/10 transition-colors" title="Fear"><i class="ph ph-user text-gray-500 hover:text-white text-xs"></i></a>';
  html += '<a href="' + steamUrl + '" target="_blank" class="p-1 rounded hover:bg-white/10 transition-colors" title="Steam"><i class="ph ph-steam-logo text-gray-500 hover:text-white text-xs"></i></a>';
  html += '<button onclick="copyToClipboard(\'' + esc(steamId) + '\', this)" class="p-1 rounded hover:bg-white/10 transition-colors" title="SteamID"><i class="ph ph-copy text-gray-500 hover:text-white text-xs"></i></button>';
  html += '</div></div></div>';
  return html;
}

async function loadOnlineAdmins() {
  try {
    if (onlineStatusEl) onlineStatusEl.textContent = "\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...";
    var res = await fetch("/api/servers");
    var data = await res.json();
    var servers = data.servers || [];

    var allPlayers = [];
    servers.forEach(function(s) {
      (s.live_data && s.live_data.players || []).forEach(function(p) {
        if (p.is_admin) { p._server = s; allPlayers.push(p); }
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
      onlineGridEl.innerHTML = '<div class="col-span-full text-center py-8 text-gray-500 text-sm">\u041d\u0438\u043a\u043e\u0433\u043e \u043d\u0435\u0442 \u043e\u043d\u043b\u0430\u0439\u043d</div>';
      return;
    }

    var html = unique.map(function(p) { return renderOnlineCard(p); }).join("");
    onlineGridEl.innerHTML = html;
  } catch (error) {
    onlineGridEl.innerHTML = '<div class="col-span-full text-center py-8 text-gray-500 text-sm">\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c</div>';
  }
}

// ===================== ALL ADMINS TABLE =====================
function renderRow(row) {
  var steamid = esc(row.steamid);
  var steamProfile = "https://steamcommunity.com/profiles/" + steamid;
  var fearProfile = "https://fearproject.ru/profile/" + steamid;
  var kd = "-";
  if (row.kills != null && row.deaths != null && row.deaths > 0) kd = (row.kills / row.deaths).toFixed(2);
  else if (row.kills != null) kd = row.kills + "/0";

  var frozenStatus = row.is_frozen
    ? '<span class="px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">\u0437\u0430\u043c\u043e\u0440\u043e\u0436\u0435\u043d</span>'
    : '<span class="px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-gray-500">\u0430\u043a\u0442\u0438\u0432\u0435\u043d</span>';
  var banStatus = row.ban_is_banned
    ? '<span class="px-2 py-0.5 rounded text-xs font-medium bg-rose-500/20 text-rose-400">\u0437\u0430\u0431\u0430\u043d\u0435\u043d</span>'
    : '<span class="px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-gray-500">\u0447\u0438\u0441\u0442\u043e</span>';

  var faceit = row.faceit_level != null
    ? '<a href="https://www.faceit.com/en/players/' + steamid + '" target="_blank" class="hover:underline">' + faceitBadge(row.faceit_level, row.faceit_elo) + "</a>"
    : faceitBadge(null, null);

  var links = '<div class="flex items-center gap-1.5">'
    + '<a href="' + fearProfile + '" target="_blank" title="Fear Profile" class="p-1 rounded hover:bg-white/10 transition-colors"><i class="ph ph-user text-gray-400 hover:text-white text-sm"></i></a>'
    + '<a href="' + steamProfile + '" target="_blank" title="Steam Profile" class="p-1 rounded hover:bg-white/10 transition-colors"><i class="ph ph-steam-logo text-gray-400 hover:text-white text-sm"></i></a>'
    + '<button onclick="copyToClipboard(\'' + steamid + '\', this)" title="SteamID" class="p-1 rounded hover:bg-white/10 transition-colors"><i class="ph ph-copy text-gray-400 hover:text-white text-sm"></i></button>'
    + "</div>";

  var tr = document.createElement("tr");
  tr.className = "border-t border-white/5 hover:bg-white/[0.04] transition-colors";
  tr.innerHTML =
    '<td class="px-3 py-3"><img src="' + esc(row.avatar_full || "") + '" alt="" class="w-8 h-8 rounded-full"></td>'
    + '<td class="px-3 py-3 text-white font-medium">' + esc(row.name || "-") + "</td>"
    + '<td class="px-3 py-3 font-mono text-gray-400 text-xs">' + steamid + "</td>"
    + '<td class="px-3 py-3 text-gray-300">' + esc(row.group_display_name || row.group_name || "-") + "</td>"
    + '<td class="px-3 py-3">' + frozenStatus + "</td>"
    + '<td class="px-3 py-3 text-gray-300">' + esc(row.discord_nickname || "-") + "</td>"
    + '<td class="px-3 py-3 text-gray-300 font-semibold">' + (row.rank != null ? "#" + row.rank : "-") + "</td>"
    + '<td class="px-3 py-3 text-gray-300">' + kd + "</td>"
    + '<td class="px-3 py-3 text-gray-400">' + fmtHours(row.playtime) + "</td>"
    + '<td class="px-3 py-3">' + faceit + "</td>"
    + '<td class="px-3 py-3">' + banStatus + "</td>"
    + '<td class="px-3 py-3 text-gray-500 text-xs">' + fmtDate(row.updated_at) + "</td>"
    + '<td class="px-3 py-3">' + links + "</td>";
  return tr;
}

function clearRows() {
  rowsEl.innerHTML = "";
  currentPage = 0;
  totalRows = 0;
  var s = document.createElement("tr");
  s.id = "scrollSentinel";
  s.innerHTML = '<td colspan="13" class="px-4 py-4 text-center text-gray-500 text-sm">\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430...</td>';
  rowsEl.appendChild(s);
  observer.observe(s);
}

async function loadPage(reset) {
  if (loading) return;
  if (!reset && currentPage * PAGE_SIZE >= totalRows && totalRows > 0) return;
  loading = true;

  if (reset) clearRows();

  var search = searchInput ? searchInput.value.trim() : "";
  var offset = reset ? 0 : currentPage * PAGE_SIZE;
  var url = "/api/admins?limit=" + PAGE_SIZE + "&offset=" + offset + "&sortBy=admin_id&sortDir=DESC" + (search ? "&search=" + encodeURIComponent(search) : "");

  try {
    var res = await fetch(url);
    var data = await res.json();
    totalRows = data.total || 0;
    var rows = data.rows || [];

    if (reset) rowsEl.innerHTML = "";

    var fragment = document.createDocumentFragment();
    rows.forEach(function(row) { fragment.appendChild(renderRow(row)); });
    rowsEl.appendChild(fragment);

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
}, { rootMargin: "200px" });

if (searchInput) {
  searchInput.addEventListener("input", function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function() { loadPage(true); }, 300);
  });
}

// Tabs
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

// Refresh
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
