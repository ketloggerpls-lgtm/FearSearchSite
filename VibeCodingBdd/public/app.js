var currentUser = null;
fetch("/api/auth/me").then(function(r) {
  if (r.status === 401) { window.location.href = "/login"; return; }
  return r.json();
}).then(function(data) {
  if (data && data.user) {
    currentUser = data.user;
    loadProfile(data.user);
  }
}).catch(function() {});

function loadProfile(user) {
  var pName = document.getElementById("profileName");
  var pRole = document.getElementById("profileRole");
  var pAvatar = document.getElementById("profileAvatar");
  var pPlaceholder = document.getElementById("profilePlaceholder");
  if (pName) pName.textContent = user.discord_display || user.username || "";
  if (pRole) pRole.textContent = user.discord_role || user.role || "";
  if (user.discord_avatar) {
    if (pAvatar) { pAvatar.src = user.discord_avatar; pAvatar.classList.remove("hidden"); }
    if (pPlaceholder) pPlaceholder.classList.add("hidden");
  } else {
    if (pPlaceholder) pPlaceholder.classList.remove("hidden");
    if (pAvatar) pAvatar.classList.add("hidden");
  }
  if (user.discord_id === "1500235583367417866" || user.role === "owner") {
    document.querySelectorAll(".tab-owner-only").forEach(function(el) { el.style.display = ""; });
  }
}

function loadDashboardStats() {
  fetch("/api/dashboard/stats").then(function(r){return r.json()}).then(function(data) {
    document.getElementById("statAdmins").textContent = data.adminsOnline || 0;
    document.getElementById("statPlayers").textContent = data.playersOnline || 0;
    document.getElementById("statReports").textContent = data.reportsCount || 0;
  }).catch(function(){});
}

var refreshBtn = document.getElementById("refreshBtn");
var statusEl = document.getElementById("status");
var rowsEl = document.getElementById("rows");
var paginationEl = document.getElementById("pagination");
var searchInput = document.getElementById("searchInput");
var onlineGridEl = document.getElementById("onlineGrid");
var onlineCountEl = document.getElementById("onlineCount");
var allCountEl = document.getElementById("allCount");

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
  if (h >= 1) return h.toFixed(1) + "ч";
  return Math.round(Number(seconds) / 60) + "м";
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
    if (diff < 0) return "только что";
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return "только что";
    if (mins < 60) return mins + " м. назад";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + " ч. назад";
    var days = Math.floor(hours / 24);
    if (days < 30) return days + " д. назад";
    if (days < 365) return Math.floor(days / 30) + " м. назад";
    return Math.floor(days / 365) + " г. " + Math.floor((days % 365) / 30) + " м.";
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
    "GLADMIN": "#f95dff", "Гл. Администратор": "#f95dff",
    "STADMIN": "#22c7aa", "Ст. Администратор": "#22c7aa", "Ст. Админ": "#22c7aa",
    "STMODER": "#8c56f0", "Ст. Модератор": "#8c56f0", "Ст. Модер": "#8c56f0",
    "MODER": "#e75288", "Модератор": "#e75288",
    "MLMODER": "#e2bb6d", "Мл. Модератор": "#e2bb6d",
    "STAFF": "#eab308", "Стафф": "#eab308",
    "admin": "#6b7280", "Администратор": "#6b7280",
    "admin+": "#9ca3af", "Администратор +": "#9ca3af",
    "Владелец": "#ff3c3c", "Куратор": "#ff8c00",
    "Разработчик": "#3a84c8",
    "Спец. Администратор": "#d39ae1",
    "Модератор Discord": "#bd458c",
    "Модератор месяца": "#da5f23"
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
  if (playtimeStr && playtimeStr !== "-") meta.push(playtimeStr + " на сайте");
  var ageStr = fmtAge(fearCreatedAt);
  if (ageStr) meta.push(ageStr);
  if (meta.length > 0) {
    html += '<div class="flex items-center gap-1.5 flex-wrap text-[11px] text-gray-500">';
    meta.forEach(function(item, i) {
      if (i > 0) html += '<span class="text-gray-700">·</span>';
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

    if (unique.length === 0) {
      onlineGridEl.innerHTML = '<div class="col-span-full text-center py-8 text-gray-500 text-sm">Никого нет онлайн</div>';
      return;
    }

    var html = unique.map(function(p) { return renderOnlineCard(p); }).join("");
    onlineGridEl.innerHTML = html;
  } catch (error) {
    onlineGridEl.innerHTML = '<div class="col-span-full text-center py-8 text-gray-500 text-sm">Не удалось загрузить</div>';
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
    ? '<span class="px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">заморожен</span>'
    : '<span class="px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-gray-500">активен</span>';
  var banStatus = row.ban_is_banned
    ? '<span class="px-2 py-0.5 rounded text-xs font-medium bg-rose-500/20 text-rose-400">забанен</span>'
    : '<span class="px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-gray-500">чисто</span>';

  var faceit = row.faceit_level != null
    ? '<a href="https://www.faceit.com/en/players/' + steamid + '" target="_blank" class="hover:underline">' + faceitBadge(row.faceit_level, row.faceit_elo) + "</a>"
    : faceitBadge(null, null);

  var links = '<div class="flex items-center gap-1.5">'
    + '<a href="' + fearProfile + '" target="_blank" title="Fear Profile" class="p-1 rounded hover:bg-white/10 transition-colors"><i class="ph ph-user text-gray-400 hover:text-white text-sm"></i></a>'
    + '<a href="' + steamProfile + '" target="_blank" title="Steam Profile" class="p-1 rounded hover:bg-white/10 transition-colors"><i class="ph ph-steam-logo text-gray-400 hover:text-white text-sm"></i></a>'
    + '<button onclick="copyToClipboard(\'' + steamid + '\', this)" title="SteamID" class="p-1 rounded hover:bg-white/10 transition-colors"><i class="ph ph-copy text-gray-400 hover:text-white text-sm"></i></a>'
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
  s.innerHTML = '<td colspan="13" class="px-4 py-4 text-center"><div class="flex items-center justify-center gap-2 text-gray-600 text-sm"><div class="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></div></div></td>';
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
    if (paginationEl) paginationEl.textContent = "Показано " + Math.min(currentPage * PAGE_SIZE, totalRows) + " из " + totalRows;
    if (allCountEl) allCountEl.textContent = "(" + totalRows + ")";
  } catch (error) {
    if (paginationEl) paginationEl.textContent = "Ошибка: " + error.message;
  } finally {
    loading = false;
  }
}

var scrollPanel = document.querySelector("#tab-all .scroll-panel");
var observer = new IntersectionObserver(function(entries) {
  entries.forEach(function(entry) {
    if (entry.isIntersecting && !loading) loadPage(false);
  });
}, { root: scrollPanel, rootMargin: "200px" });

if (searchInput) {
  searchInput.addEventListener("input", function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function() { loadPage(true); }, 300);
  });
}

// ===================== STATS TAB =====================
var ROLE_COLORS = {
  "Владелец": "#ff3c3c", "Куратор": "#ff8c00", "Разработчик": "#3a84c8",
  "Гл. Администратор": "#f95dff", "Ст. Администратор": "#22c7aa",
  "Спец. Администратор": "#d39ae1", "Ст. Модератор": "#8c56f0", "Ст. Модер": "#8c56f0",
  "Модератор": "#e75288", "Мл. Модератор": "#e2bb6d",
  "Модератор Discord": "#bd458c", "Модератор месяца": "#da5f23",
  "Администратор": "#ebc04e", "Администратор +": "#ffcc00", "Стафф": "#eab308"
};
function getRoleColor(role) { return ROLE_COLORS[role] || "#6b7280"; }

var cachedStatsData = null;
var currentStatsView = "grouped";
var currentPeriod = "this-month";

function getPeriodParams(period) {
  var now = new Date();
  var from, to;
  switch(period) {
    case "this-month":
      from = new Date(now.getFullYear(), now.getMonth(), 1); to = now; break;
    case "last-month":
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59); break;
    case "this-week": {
      var day = now.getDay(); var diff = day === 0 ? 6 : day - 1;
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
      from.setHours(0, 0, 0, 0); to = now; break;
    }
    case "last-week": {
      var day2 = now.getDay(); var diff2 = day2 === 0 ? 6 : day2 - 1;
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff2 - 7);
      from.setHours(0, 0, 0, 0);
      to = new Date(from.getTime() + 7 * 86400000 - 1); break;
    }
    case "all": from = new Date(2020, 0, 1); to = now; break;
    default: from = new Date(now.getFullYear(), now.getMonth(), 1); to = now;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

function formatPeriodLabel(period) {
  var p = getPeriodParams(period);
  return new Date(p.from).toLocaleDateString("ru-RU") + " — " + new Date(p.to).toLocaleDateString("ru-RU");
}

function renderStatsRow(s, idx) {
  var fearUrl = "https://fearproject.ru/profile/" + s.steamid;
  var bansUrl = "https://davidonchik.online/admin/" + s.steamid + "?type=1";
  var mutesUrl = "https://davidonchik.online/admin/" + s.steamid + "?type=2";
  var color = getRoleColor(s.role_label);
  return '<div class="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors">'
    + '<span class="text-gray-600 text-sm font-mono w-5 text-right">' + idx + ".</span>"
    + '<div class="flex-1 min-w-0">'
    + '<span class="text-white font-medium text-sm">' + esc(s.name || s.steamid) + "</span>"
    + '<a href="' + fearUrl + '" target="_blank" class="text-gray-500 text-xs ml-2 font-mono hover:text-[#5865F2] transition-colors" title="Профиль Fear">' + esc(s.steamid) + ' <i class="ph ph-link-simple text-[10px]"></i></a>'
    + '<span class="text-gray-700 text-xs ml-1 font-mono cursor-pointer hover:text-gray-400" onclick="copyToClipboard(\'' + s.steamid + '\', this)" title="Скопировать SteamID"><i class="ph ph-copy text-[11px]"></i></span>'
    + (s.role_label ? '<span class="text-xs ml-2 px-1.5 py-0.5 rounded" style="background:' + color + '20;color:' + color + '">' + esc(s.role_label) + '</span>' : '')
    + "</div>"
    + '<div class="flex items-center gap-3 text-xs shrink-0">'
    + '<a href="' + bansUrl + '" target="_blank" title="Баны на davidonchik.online" class="hover:opacity-80 transition-opacity"><span class="text-gray-500"><i class="ph ph-hammer"></i></span> <span class="text-amber-400 font-semibold">' + (s.bans||0) + "</span></a>"
    + '<a href="' + mutesUrl + '" target="_blank" title="Муты на davidonchik.online" class="hover:opacity-80 transition-opacity"><span class="text-gray-500"><i class="ph ph-megaphone"></i></span> <span class="text-purple-400 font-semibold">' + (s.mutes||0) + "</span></a>"
    + '<span title="Всего"><span class="text-gray-500"><i class="ph ph-chart-line"></i></span> <span class="text-white font-semibold">' + (s.total||0) + "</span></span>"
    + '<span title="Снято"><span class="text-gray-500"><i class="ph ph-scissors"></i></span> <span class="text-gray-400 font-semibold">' + (s.removed||0) + "</span></span>"
    + "</div></div>";
}

function renderStatsGrouped(data) {
  var el = document.getElementById("statsContent");
  el.innerHTML = "";
  el.classList.remove("hidden");

  var groups = {};
  (data.staff || []).forEach(function(s) {
    var key = s.role_label || "Стафф";
    if (!groups[key]) groups[key] = { label: key, role_order: s.role_order || 99, members: [] };
    groups[key].members.push(s);
  });

  var sorted = Object.values(groups).sort(function(a, b) { return a.role_order - b.role_order; });
  var idx = 1;
  sorted.forEach(function(g) {
    var color = getRoleColor(g.label);
    var section = document.createElement("div");
    var headerHtml = '<div class="role-header mb-3" style="border-color:' + color + '">'
      + '<h2 class="text-base font-bold" style="color:' + color + '">' + esc(g.label) + '</h2>'
      + '<span class="text-gray-600 text-xs">' + g.members.length + ' чел.</span></div>';
    var listHtml = '<div class="space-y-1">';
    g.members.forEach(function(s) {
      listHtml += renderStatsRow(s, idx);
      idx++;
    });
    listHtml += "</div>";
    section.innerHTML = headerHtml + listHtml;
    el.appendChild(section);
  });
}

function renderStatsTop(data) {
  var el = document.getElementById("statsContent");
  el.innerHTML = "";
  el.classList.remove("hidden");
  var all = (data.staff || []).slice().sort(function(a,b) { return (b.total||0) - (a.total||0); });
  var listHtml = '<div class="space-y-1">';
  all.forEach(function(s, i) { listHtml += renderStatsRow(s, i + 1); });
  listHtml += "</div>";
  el.innerHTML = listHtml;
}

function renderStats() {
  if (!cachedStatsData) return;
  if (currentStatsView === "grouped") renderStatsGrouped(cachedStatsData);
  else if (currentStatsView === "top") renderStatsTop(cachedStatsData);
}

function loadStats() {
  var loading = document.getElementById("statsLoading");
  var content = document.getElementById("statsContent");
  var empty = document.getElementById("statsEmpty");
  loading.classList.remove("hidden");
  content.classList.add("hidden");
  empty.classList.add("hidden");
  var params = getPeriodParams(currentPeriod);
  var url = "/api/staff-stats?from=" + encodeURIComponent(params.from) + "&to=" + encodeURIComponent(params.to);
  document.getElementById("periodLabel").textContent = formatPeriodLabel(currentPeriod);
  fetch(url).then(function(r){return r.json()}).then(function(data) {
    loading.classList.add("hidden");
    if (!data.grouped || Object.keys(data.grouped).length === 0) {
      empty.classList.remove("hidden");
      return;
    }
    document.getElementById("totalText").textContent = (data.staff ? data.staff.length : 0) + " чел.";
    cachedStatsData = data;
    renderStats();
  }).catch(function(err) {
    loading.classList.add("hidden");
    empty.textContent = "Ошибка: " + err.message;
    empty.classList.remove("hidden");
  });
}

// ===================== LOGS TAB =====================
var logsPage = 0;
var logsPageSize = 50;
var logsSearchQuery = "";

function fmtStatus(s) {
  if (s === 1) return '<span class="text-emerald-400">Активен</span>';
  if (s === 2) return '<span class="text-gray-500">Снят</span>';
  if (s === 4) return '<span class="text-yellow-400">Истёк</span>';
  return '<span class="text-gray-600">' + s + '</span>';
}
function fmtType(t) {
  if (t === 1) return '<span class="text-amber-400"><i class="ph ph-hammer"></i> Бан</span>';
  if (t === 2) return '<span class="text-purple-400"><i class="ph ph-megaphone"></i> Мут</span>';
  return '<span class="text-gray-500">Тип ' + t + '</span>';
}
function fmtDur(sec) {
  if (!sec || sec <= 0) return "Навсегда";
  var d = Math.floor(sec / 86400);
  var h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return d + "д " + h + "ч";
  var m = Math.floor((sec % 3600) / 60);
  if (h > 0) return h + "ч " + m + "м";
  return m + "м";
}
function fmtTs(ts) {
  if (!ts) return "—";
  var d = new Date(ts * 1000);
  return d.toLocaleDateString("ru-RU") + " " + d.toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"});
}

function renderLogRow(r) {
  var typeIcon = fmtType(r.type);
  var statusStr = fmtStatus(r.status);
  var fearUrl = "https://fearproject.ru/profile/" + r.steamid;
  var adminProfileUrl = r.admin_steamid ? ("https://fearproject.ru/profile/" + r.admin_steamid) : "#";
  var adminName = esc(r.admin || '—');
  var adminLink;
  if (r.admin_steamid) {
    adminLink = '<span class="text-[#5865F2] font-medium cursor-pointer hover:underline shrink-0" onclick="openAdminProfile(\'' + esc(r.admin_steamid) + '\', \'' + esc(r.admin || '') + '\')" title="Профиль ' + adminName + '">' + adminName + '</span>';
  } else {
    adminLink = '<span class="text-[#5865F2] font-medium shrink-0">' + adminName + '</span>';
  }
  return '<div class="flex items-center gap-3 px-4 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-xs">'
    + '<span class="shrink-0 w-[130px] text-gray-500 font-mono">' + fmtTs(r.created) + '</span>'
    + '<span class="shrink-0 w-[60px]">' + typeIcon + '</span>'
    + '<div class="flex-1 min-w-0 flex items-center gap-1">'
    + adminLink
    + ' <i class="ph ph-arrow-right text-gray-600 shrink-0"></i> '
    + '<a href="' + fearUrl + '" target="_blank" class="text-white hover:text-[#5865F2] transition-colors shrink-0">' + esc(r.name || r.steamid) + '</a>'
    + '<span class="text-gray-600 font-mono ml-1 shrink-0">(' + esc(r.steamid) + ')</span>'
    + '</div>'
    + '<span class="shrink-0 w-[180px] text-gray-400 break-all leading-tight" title="' + esc(r.reason) + '">' + esc(r.reason || '—') + '</span>'
    + '<span class="shrink-0 w-[80px] text-gray-500">' + fmtDur(r.duration) + '</span>'
    + '<span class="shrink-0 w-[70px] text-right">' + statusStr + '</span>'
    + '</div>';
}

function openAdminProfile(steamid, name) {
  var modal = document.getElementById("adminProfileModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "adminProfileModal";
    modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm hidden";
    modal.innerHTML = '<div class="glass-panel rounded-2xl p-6 w-[360px] relative">'
      + '<button onclick="closeAdminProfile()" class="absolute top-3 right-3 text-gray-500 hover:text-white"><i class="ph ph-x text-lg"></i></button>'
      + '<div id="adminProfileBody" class="text-center"></div></div>';
    modal.addEventListener("click", function(e) { if (e.target === modal) closeAdminProfile(); });
    document.body.appendChild(modal);
  }
  var body = document.getElementById("adminProfileBody");
  body.innerHTML = '<div class="skeleton h-[120px] rounded-xl mb-3"></div>';
  modal.classList.remove("hidden");

  var fearUrl = "https://fearproject.ru/profile/" + steamid;
  var steamUrl = "https://steamcommunity.com/profiles/" + steamid;
  var statsUrl = "/api/punishments/staff/" + steamid + "?type=0&limit=100";

  fetch(statsUrl).then(function(r){return r.json()}).then(function(rows) {
    var bans = 0, mutes = 0;
    (rows || []).forEach(function(r) {
      if (r.status === 2) return;
      if (r.type === 1) bans++;
      else if (r.type === 2) mutes++;
    });
    body.innerHTML = ''
      + '<div class="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-3"><i class="ph ph-user text-2xl text-gray-400"></i></div>'
      + '<div class="text-base font-bold text-white mb-0.5">' + esc(name || steamid) + '</div>'
      + '<div class="text-xs text-gray-500 font-mono mb-3">' + esc(steamid) + '</div>'
      + '<div class="flex items-center justify-center gap-4 mb-4">'
      + '<div class="text-center"><div class="text-lg font-bold text-amber-400">' + bans + '</div><div class="text-[10px] text-gray-500">Баны</div></div>'
      + '<div class="w-px h-8 bg-white/10"></div>'
      + '<div class="text-center"><div class="text-lg font-bold text-purple-400">' + mutes + '</div><div class="text-[10px] text-gray-500">Муты</div></div>'
      + '<div class="w-px h-8 bg-white/10"></div>'
      + '<div class="text-center"><div class="text-lg font-bold text-white">' + (bans + mutes) + '</div><div class="text-[10px] text-gray-500">Всего</div></div>'
      + '</div>'
      + '<div class="space-y-2">'
      + '<a href="' + fearUrl + '" target="_blank" class="block w-full py-2 rounded-lg bg-[#5865F2]/15 hover:bg-[#5865F2]/25 text-[#818cf8] text-xs font-semibold transition-colors text-center">Fear Профиль</a>'
      + '<a href="' + steamUrl + '" target="_blank" class="block w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs font-medium transition-colors text-center">Steam Профиль</a>'
      + '</div>';
  }).catch(function() {
    body.innerHTML = '<div class="text-gray-500 text-sm">Ошибка загрузки</div>';
  });
}
function closeAdminProfile() {
  var m = document.getElementById("adminProfileModal");
  if (m) m.classList.add("hidden");
}

function loadLogs(page) {
  logsPage = page || 0;
  var lc = document.getElementById("logsContent");
  lc.innerHTML = '<div class="space-y-0.5"><div class="skeleton h-[36px]"></div><div class="skeleton h-[36px]"></div><div class="skeleton h-[36px]"></div><div class="skeleton h-[36px]"></div><div class="skeleton h-[36px]"></div></div>';
  document.getElementById("logsCount").textContent = "";
  document.getElementById("logsPaging").innerHTML = "";
  var offset = logsPage * logsPageSize;
  var url = "/api/punishments/logs?limit=" + logsPageSize + "&offset=" + offset;
  if (logsSearchQuery) url += "&search=" + encodeURIComponent(logsSearchQuery);
  fetch(url).then(function(r){return r.json()}).then(function(data) {
    lc.innerHTML = "";
    if (!data.rows || data.rows.length === 0) {
      lc.innerHTML = '<div class="text-center text-gray-500 py-8">Нет записей</div>';
      document.getElementById("logsCount").textContent = "";
      document.getElementById("logsPaging").innerHTML = "";
      return;
    }
    document.getElementById("logsCount").textContent = "Найдено: " + data.total;
    data.rows.forEach(function(r) { lc.innerHTML += renderLogRow(r); });
    var totalPages = Math.ceil(data.total / logsPageSize);
    var paging = document.getElementById("logsPaging");
    paging.innerHTML = "";
    if (totalPages <= 1) return;
    if (logsPage > 0) {
      var prevBtn = document.createElement("button");
      prevBtn.textContent = "← Назад";
      prevBtn.className = "px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-400 transition-colors";
      prevBtn.onclick = function() { loadLogs(logsPage - 1); };
      paging.appendChild(prevBtn);
    }
    var info = document.createElement("span");
    info.className = "text-gray-600 text-xs";
    info.textContent = (logsPage + 1) + " / " + totalPages;
    paging.appendChild(info);
    if (logsPage < totalPages - 1) {
      var nextBtn = document.createElement("button");
      nextBtn.textContent = "Далее →";
      nextBtn.className = "px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-400 transition-colors";
      nextBtn.onclick = function() { loadLogs(logsPage + 1); };
      paging.appendChild(nextBtn);
    }
  }).catch(function(err) {
    lc.innerHTML = '<div class="text-center text-red-400 py-8">Ошибка: ' + esc(err.message) + '</div>';
  });
}

// ===================== TABS =====================
var statsLoaded = false;
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
    if (btn.dataset.tab === "stats" && !statsLoaded) {
      statsLoaded = true;
      loadStats();
    }
    if (btn.dataset.tab === "logs") {
      loadLogs(0);
    }
    if (btn.dataset.tab === "mystats") {
      loadMyStats();
    }
    if (btn.dataset.tab === "adminpanel") {
      loadAdminPanel();
    }
  });
});

// Stats controls
document.querySelectorAll(".period-btn").forEach(function(btn) {
  btn.addEventListener("click", function() {
    document.querySelectorAll(".period-btn").forEach(function(b) { b.classList.remove("active"); });
    btn.classList.add("active");
    currentPeriod = btn.dataset.period;
    loadStats();
  });
});

var viewGroupedBtn = document.getElementById("viewGrouped");
var viewTopBtn = document.getElementById("viewTop");
if (viewGroupedBtn) {
  viewGroupedBtn.addEventListener("click", function() {
    currentStatsView = "grouped"; this.classList.add("active");
    if (viewTopBtn) viewTopBtn.classList.remove("active");
    renderStats();
  });
}
if (viewTopBtn) {
  viewTopBtn.addEventListener("click", function() {
    currentStatsView = "top"; this.classList.add("active");
    if (viewGroupedBtn) viewGroupedBtn.classList.remove("active");
    renderStats();
  });
}

// Logs search
var logsSearchBtn = document.getElementById("logsSearchBtn");
var logsSearchInput = document.getElementById("logsSearch");
if (logsSearchBtn) {
  logsSearchBtn.addEventListener("click", function() {
    logsSearchQuery = logsSearchInput.value.trim();
    loadLogs(0);
  });
}
if (logsSearchInput) {
  logsSearchInput.addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
      logsSearchQuery = this.value.trim();
      loadLogs(0);
    }
  });
}

// Refresh
if (refreshBtn) {
  refreshBtn.addEventListener("click", async function() {
    try {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<i class="ph ph-arrows-clockwise animate-spin"></i> Обновление...';
      var response = await fetch("/api/refresh", { method: "POST" });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || "Ошибка");
      setTimeout(function() { loadOnlineAdmins(); loadDashboardStats(); }, 3000);
    } catch (error) {
      alert(error.message);
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="ph ph-arrows-clockwise"></i> Обновить';
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
loadDashboardStats();
setInterval(loadDashboardStats, 30000);

function loadMyStats() {
  var el = document.getElementById("myStatsContent");
  el.innerHTML = '<div class="skeleton h-[80px]"></div>';
  fetch("/api/my-stats").then(function(r){return r.json()}).then(function(data) {
    if (!data.steamid) {
      el.innerHTML = '<div class="glass-panel rounded-xl p-6 text-center"><div class="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3"><i class="ph ph-user-circle text-3xl text-gray-600"></i></div><div class="text-gray-400 text-sm mb-1">SteamID не найден</div><div class="text-gray-600 text-xs">Ваш Discord аккаунт не привязан к профилю на сервере</div></div>';
      return;
    }
    var html = '<div class="glass-panel rounded-xl p-5 mb-4">';
    html += '<div class="flex items-center gap-4 mb-5">';
    if (currentUser && currentUser.discord_avatar) {
      html += '<img src="' + esc(currentUser.discord_avatar) + '" class="w-14 h-14 rounded-full object-cover">';
    } else {
      html += '<div class="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center"><i class="ph ph-user text-2xl text-gray-400"></i></div>';
    }
    html += '<div><div class="text-lg font-bold text-white">' + esc(currentUser ? (currentUser.discord_display || currentUser.username) : '') + '</div>';
    html += '<div class="text-xs text-gray-500 font-mono mt-0.5">' + esc(data.steamid) + '</div></div></div>';
    html += '<div class="flex items-center gap-6 mb-5">';
    html += '<div class="flex-1 text-center py-3 rounded-xl bg-amber-500/10 border border-amber-500/20"><div class="text-2xl font-bold text-amber-400">' + data.bans + '</div><div class="text-[11px] text-gray-500 mt-0.5">Банов выдано</div></div>';
    html += '<div class="flex-1 text-center py-3 rounded-xl bg-purple-500/10 border border-purple-500/20"><div class="text-2xl font-bold text-purple-400">' + data.mutes + '</div><div class="text-[11px] text-gray-500 mt-0.5">Мутов выдано</div></div>';
    html += '<div class="flex-1 text-center py-3 rounded-xl bg-white/5 border border-white/10"><div class="text-2xl font-bold text-white">' + data.total + '</div><div class="text-[11px] text-gray-500 mt-0.5">Всего</div></div>';
    html += '</div></div>';
    if (data.rows && data.rows.length > 0) {
      html += '<div class="glass-panel rounded-xl p-4"><div class="text-xs font-semibold text-gray-400 mb-3">Последние наказания</div>';
      html += '<div class="space-y-1">';
      data.rows.slice(0, 30).forEach(function(r) {
        var t = r.type === 1 ? '<span class="text-amber-400">Бан</span>' : '<span class="text-purple-400">Мут</span>';
        var s = r.status === 1 || r.status === 4 ? '<span class="text-emerald-400">Активен</span>' : r.status === 2 ? '<span class="text-gray-500">Снят</span>' : '<span class="text-yellow-400">Истёк</span>';
        html += '<div class="flex items-center gap-2 text-xs py-2 px-3 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors">';
        html += '<span class="shrink-0 w-[120px] text-gray-500 font-mono">' + fmtTs(r.created) + '</span>';
        html += '<span class="shrink-0 w-[40px]">' + t + '</span>';
        html += '<span class="flex-1 min-w-0 text-gray-400 truncate" title="' + esc(r.reason) + '">' + esc(r.reason || '—') + '</span>';
        html += '<span class="shrink-0 text-gray-500">' + fmtDur(r.duration) + '</span>';
        html += '<span class="shrink-0">' + s + '</span>';
        html += '</div>';
      });
      html += '</div></div>';
    }
    el.innerHTML = html;
  }).catch(function(err) {
    el.innerHTML = '<div class="glass-panel rounded-xl p-6 text-center"><div class="text-red-400 text-sm">Ошибка загрузки: ' + esc(err.message) + '</div></div>';
  });
}

function loadAdminPanel() {
  var usersEl = document.getElementById("adminUsersList");
  var logsEl = document.getElementById("adminLoginLogs");
  if (usersEl) usersEl.innerHTML = '<div class="skeleton h-[60px]"></div>';
  if (logsEl) logsEl.innerHTML = '<div class="skeleton h-[60px]"></div>';

  fetch("/api/admin/users").then(function(r){return r.json()}).then(function(data) {
    if (!usersEl) return;
    var users = data.users || [];
    if (!users.length) { usersEl.innerHTML = '<div class="text-gray-500 text-xs">Нет пользователей</div>'; return; }
    var html = '';
    users.forEach(function(u) {
      html += '<div class="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.03]">';
      html += '<div class="flex-1 min-w-0"><div class="text-sm font-medium text-white truncate">' + esc(u.username) + '</div>';
      html += '<div class="text-[10px] text-gray-500">' + esc(u.discord_name || '—') + ' · DiscordID: ' + esc(u.discord_id || '—') + '</div></div>';
      html += '<div class="flex items-center gap-2 shrink-0">';
      html += '<span class="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">' + esc(u.role) + '</span>';
      if (u.active_sessions > 0) html += '<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">' + u.active_sessions + ' сессия</span>';
      html += '</div></div>';
    });
    usersEl.innerHTML = html;
  }).catch(function() { if (usersEl) usersEl.innerHTML = '<div class="text-red-400 text-xs">Ошибка</div>'; });

  fetch("/api/admin/login-logs?limit=30").then(function(r){return r.json()}).then(function(data) {
    if (!logsEl) return;
    var logs = data.logs || [];
    if (!logs.length) { logsEl.innerHTML = '<div class="text-gray-500 text-xs">Нет логов</div>'; return; }
    var html = '';
    logs.forEach(function(l) {
      var d = new Date(l.created_at);
      var ts = d.toLocaleDateString("ru-RU") + " " + d.toLocaleTimeString("ru-RU", {hour:"2-digit",minute:"2-digit"});
      html += '<div class="flex items-center gap-2 py-1.5 px-2 rounded bg-white/[0.03] text-[11px]">';
      html += '<span class="shrink-0 w-[100px] text-gray-500 font-mono">' + ts + '</span>';
      html += '<span class="shrink-0 text-white font-medium">' + esc(l.username || '—') + '</span>';
      html += '<span class="flex-1 min-w-0 text-gray-400 truncate">' + esc(l.action || '') + '</span>';
      html += '<span class="shrink-0 text-gray-600 font-mono">' + esc(l.ip_address || '—') + '</span>';
      html += '</div>';
    });
    logsEl.innerHTML = html;
  }).catch(function() { if (logsEl) logsEl.innerHTML = '<div class="text-red-400 text-xs">Ошибка</div>'; });
}
