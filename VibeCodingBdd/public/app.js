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
  var isOwner = user.discord_id === "1500235583367417866" || user.role === "owner";
  if (isOwner) {
    document.querySelectorAll(".tab-owner-only").forEach(function(el) { el.style.display = ""; });
  }
  fetch("/api/tab-access").then(function(r){return r.json()}).then(function(data) {
    var userRank = user.discord_role_rank || 0;
    (data.tabs || []).forEach(function(t) {
      var btn = document.querySelector('.sidebar-nav-btn[data-tab="' + t.tab_id + '"]');
      if (!btn) return;
      if (!t.enabled || userRank < t.min_role_rank) {
        btn.style.display = 'none';
      } else {
        btn.style.display = '';
      }
    });
  }).catch(function(){});
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
  var kills = p.db_kills || 0;
  var deaths = p.db_deaths || 0;
  var kd = deaths > 0 ? (kills / deaths).toFixed(2) : (kills > 0 ? kills + "/0" : "-");
  var isHidden = p.db_hidden;
  var connectUrl = "steam://connect/" + ip + ":" + port;
  var steamUrl = "https://steamcommunity.com/profiles/" + steamId;
  var fearUrl = "https://fearproject.ru/profile/" + steamId;

  var html = '<div class="admin-card online rounded-xl bg-white/[0.03] p-3 flex flex-col gap-2 fade-in">';
  html += '<div class="flex items-start gap-2.5">';
  html += '<a href="' + fearUrl + '" target="_blank" class="relative shrink-0 block">';
  if (avatar) {
    html += '<img src="' + esc(avatar) + '" alt="" class="w-10 h-10 rounded-lg object-cover cursor-pointer hover:ring-2 hover:ring-[#5865F2]/50 transition-all" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
    html += '<div class="w-10 h-10 rounded-lg bg-white/10 items-center justify-center hidden">' + letterAvatar(name, 40) + '</div>';
  } else {
    html += letterAvatar(name, 40);
  }
  html += '<div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0a0a0c]"></div>';
  html += '</a>';
  html += '<div class="flex-1 min-w-0">';
  html += '<div class="flex items-center gap-1.5 flex-wrap">';
  html += '<a href="' + fearUrl + '" target="_blank" class="text-sm font-semibold text-white truncate max-w-[160px] hover:text-[#818cf8] transition-colors">' + esc(name) + '</a>';
  html += teamTag(team);
  if (isHidden) html += '<span class="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">Hide</span>';
  html += '</div>';
  if (p.db_group_display_name || p.db_group_name) {
    html += '<div class="text-[10px] text-[#818cf8] font-medium mt-0.5">' + esc(p.db_group_display_name || p.db_group_name) + '</div>';
  }
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
  html += '<div class="flex items-center gap-1.5 flex-wrap">';
  html += '<span class="tag" style="background:rgba(255,255,255,0.06);"><span class="text-gray-400 text-[10px]">K/D</span> <span class="text-white font-semibold text-[11px]">' + kd + '</span></span>';
  if (faceitLevel != null) html += '<span class="tag" style="background:rgba(255,255,255,0.06);"><span class="text-gray-400 text-[10px]">Faceit</span> ' + faceitBadge(faceitLevel, faceitElo) + '</span>';
  html += '</div>';
  html += '<div class="flex items-center gap-1">';
  html += '<a href="' + fearUrl + '" target="_blank" class="p-1 rounded hover:bg-white/10 transition-colors" title="Fear"><i class="ph ph-user text-gray-500 hover:text-white text-xs"></i></a>';
  html += '<a href="' + steamUrl + '" target="_blank" class="p-1 rounded hover:bg-white/10 transition-colors" title="Steam"><i class="ph ph-steam-logo text-gray-500 hover:text-white text-xs"></i></a>';
  html += '<button onclick="copyToClipboard(\'' + esc(steamId) + '\', this)" class="p-1 rounded hover:bg-white/10 transition-colors" title="SteamID"><i class="ph ph-copy text-gray-500 hover:text-white text-xs"></i></button>';
  html += '</div></div></div>';
  return html;
}

var onlineSortKey = "default";
var onlinePlayersCache = [];

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

    onlinePlayersCache = unique;
    if (onlineCountEl) onlineCountEl.textContent = "(" + unique.length + ")";
    renderOnlinePlayers();
  } catch (error) {
    onlineGridEl.innerHTML = '<div class="col-span-full text-center py-8 text-gray-500 text-sm">Не удалось загрузить</div>';
  }
}

function sortOnlinePlayers(players, key) {
  var arr = players.slice();
  switch(key) {
    case "kd":
      arr.sort(function(a, b) {
        var kda = (a.db_kills || 0) / ((a.db_deaths || 0) + 1);
        var kdb = (b.db_kills || 0) / ((b.db_deaths || 0) + 1);
        return kdb - kda;
      }); break;
    case "playtime":
      arr.sort(function(a, b) { return (b.db_playtime || 0) - (a.db_playtime || 0); }); break;
    case "fear-date":
      arr.sort(function(a, b) {
        var da = a.db_fear_created_at ? new Date(a.db_fear_created_at).getTime() : 0;
        var db = b.db_fear_created_at ? new Date(b.db_fear_created_at).getTime() : 0;
        return da - db;
      }); break;
    case "name":
      arr.sort(function(a, b) {
        var na = (a.db_name || a.nickname || "").toLowerCase();
        var nb = (b.db_name || b.nickname || "").toLowerCase();
        return na.localeCompare(nb, "ru");
      }); break;
    default:
      arr.sort(function(a, b) { return (b.db_kills || 0) - (a.db_kills || 0); });
  }
  return arr;
}

function renderOnlinePlayers() {
  var sorted = sortOnlinePlayers(onlinePlayersCache, onlineSortKey);
  if (sorted.length === 0) {
    onlineGridEl.innerHTML = '<div class="col-span-full text-center py-8 text-gray-500 text-sm">Никого нет онлайн</div>';
    return;
  }
  onlineGridEl.innerHTML = sorted.map(function(p) { return renderOnlineCard(p); }).join("");
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
  var avatarHtml;
  if (row.avatar_full) {
    avatarHtml = '<td class="px-3 py-3"><img src="' + esc(row.avatar_full) + '" alt="" class="w-8 h-8 rounded-full object-cover" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div class="w-8 h-8 rounded-full items-center justify-center hidden">' + letterAvatarRound(row.name, 32) + '</div></td>';
  } else {
    avatarHtml = '<td class="px-3 py-3">' + letterAvatarRound(row.name, 32) + '</td>';
  }
  tr.innerHTML = avatarHtml
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
  if (observer) observer.observe(s);
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
var observer = scrollPanel ? new IntersectionObserver(function(entries) {
  entries.forEach(function(entry) {
    if (entry.isIntersecting && !loading) loadPage(false);
  });
}, { root: scrollPanel, rootMargin: "200px" }) : null;

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
  var adminName = esc(r.admin || '—');
  var adminLink;
  if (r.admin_steamid) {
    adminLink = '<span class="text-[#5865F2] font-medium cursor-pointer hover:underline shrink-0" onclick="openAdminProfile(\'' + esc(r.admin_steamid) + '\', \'' + esc(r.admin || '') + '\')" title="Профиль ' + adminName + '">' + adminName + '</span>';
  } else {
    adminLink = '<span class="text-[#5865F2] font-medium shrink-0">' + adminName + '</span>';
  }
  return '<div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-xs">'
    + '<span class="shrink-0 w-[120px] text-gray-500 font-mono text-[11px]">' + fmtTs(r.created) + '</span>'
    + '<span class="shrink-0 w-[48px]">' + typeIcon + '</span>'
    + '<div class="flex-1 min-w-0 flex items-center gap-1 overflow-hidden">'
    + adminLink
    + ' <i class="ph ph-arrow-right text-gray-600 shrink-0"></i> '
    + '<a href="' + fearUrl + '" target="_blank" class="text-white hover:text-[#5865F2] transition-colors truncate">' + esc(r.name || r.steamid) + '</a>'
    + '<span class="text-gray-600 font-mono ml-1 shrink-0">(' + esc(r.steamid) + ')</span>'
    + '</div>'
    + '<span class="shrink-0 max-w-[200px] truncate text-gray-400 text-[11px]" title="' + esc(r.reason) + '">' + esc(r.reason || '—') + '</span>'
    + '<span class="shrink-0 w-[72px] text-gray-500 text-right">' + fmtDur(r.duration) + '</span>'
    + '<span class="shrink-0 w-[60px] text-right">' + statusStr + '</span>'
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
      + '<div class="text-sm text-gray-300 mb-4 flex items-center justify-center gap-1 flex-wrap">'
      + '<span><span class="text-amber-400 font-semibold">' + bans + '</span> <span class="text-gray-500">банов</span></span>'
      + '<span class="text-gray-700">·</span>'
      + '<span><span class="text-purple-400 font-semibold">' + mutes + '</span> <span class="text-gray-500">мутов</span></span>'
      + '<span class="text-gray-700">·</span>'
      + '<span><span class="text-white font-semibold">' + (bans + mutes) + '</span> <span class="text-gray-500">всего</span></span>'
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
var tabTitles = { online: '<i class="ph ph-users-three text-[#5865F2]"></i> Online', all: '<i class="ph ph-users text-[#5865F2]"></i> Все админы', stats: '<i class="ph ph-chart-bar text-[#5865F2]"></i> Статистика', logs: '<i class="ph ph-scroll text-[#5865F2]"></i> Логи', mystats: '<i class="ph ph-user-circle text-[#5865F2]"></i> Мои наказания', adminpanel: '<i class="ph ph-wrench text-[#5865F2]"></i> Админка', analytics: '<i class="ph ph-chart-line-up text-[#5865F2]"></i> Аналитика', players: '<i class="ph ph-game-controller text-[#5865F2]"></i> Все игроки' };
document.querySelectorAll(".sidebar-nav-btn").forEach(function(btn) {
  btn.addEventListener("click", function() {
    document.querySelectorAll(".sidebar-nav-btn").forEach(function(b) { b.classList.remove("active"); });
    document.querySelectorAll(".tab-content").forEach(function(c) { c.classList.remove("active"); });
    btn.classList.add("active");
    var tab = document.getElementById("tab-" + btn.dataset.tab);
    if (tab) tab.classList.add("active");
    var titleEl = document.getElementById("contentTitle");
    if (titleEl) titleEl.innerHTML = tabTitles[btn.dataset.tab] || '';
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
      loadOwnerSystem();
      loadTabAccess();
    }
    if (btn.dataset.tab === "analytics") {
      loadAnalytics();
    }
    if (btn.dataset.tab === "players") {
      loadAllPlayersTab();
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

// My Stats period controls
document.querySelectorAll(".my-stats-period-btn").forEach(function(btn) {
  btn.addEventListener("click", function() {
    document.querySelectorAll(".my-stats-period-btn").forEach(function(b) { b.classList.remove("active"); });
    btn.classList.add("active");
    currentMyStatsPeriod = btn.dataset.period;
    loadMyStats();
  });
});

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

document.querySelectorAll(".online-sort-btn").forEach(function(btn) {
  btn.addEventListener("click", function() {
    document.querySelectorAll(".online-sort-btn").forEach(function(b) { b.classList.remove("active"); });
    btn.classList.add("active");
    onlineSortKey = btn.dataset.sort;
    renderOnlinePlayers();
  });
});

setInterval(loadOnlineAdmins, 15000);
loadOnlineAdmins();
loadDashboardStats();
setInterval(loadDashboardStats, 30000);

var currentMyStatsPeriod = "this-month";

function loadMyStats() {
  var el = document.getElementById("myStatsContent");
  el.innerHTML = '<div class="skeleton h-[80px]"></div>';
  var params = getPeriodParams(currentMyStatsPeriod);
  var url = "/api/my-stats?from=" + encodeURIComponent(params.from) + "&to=" + encodeURIComponent(params.to);
  fetch(url).then(function(r){return r.json()}).then(function(data) {
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

function deleteSiteUser(userId, username) {
  if (!confirm("Удалить пользователя " + username + "? Это действие необратимо.")) return;
  fetch("/api/admin/users/" + userId + "/delete", { method: "POST" }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) { ownerShowResult("Пользователь " + username + " удалён", true); loadAdminPanel(); }
    else ownerShowResult("Ошибка: " + (d.error || "unknown"), false);
  }).catch(function() { ownerShowResult("Ошибка удаления", false); });
}

function loadAdminPanel() {
  var usersEl = document.getElementById("adminUsersList");
  var logsEl = document.getElementById("adminLoginLogs");
  var overviewEl = document.getElementById("staffOverviewCards");
  if (usersEl) usersEl.innerHTML = '<div class="skeleton h-[60px]"></div>';
  if (logsEl) logsEl.innerHTML = '<div class="skeleton h-[60px]"></div>';
  if (overviewEl) overviewEl.innerHTML = '<div class="skeleton h-[100px]"></div><div class="skeleton h-[100px]"></div><div class="skeleton h-[100px]"></div>';

  fetch("/api/staff-overview").then(function(r){return r.json()}).then(function(d) {
    if (!overviewEl) return;
    function renderStaffMini(list, label, valueFn, color) {
      var html = '<div class="rounded-xl bg-white/[0.03] border border-white/5 p-3">';
      html += '<div class="text-[11px] font-bold mb-2" style="color:' + color + '">' + label + '</div>';
      if (!list || !list.length) { html += '<div class="text-gray-600 text-[11px]">Нет данных</div>'; }
      else { list.forEach(function(s, i) {
        var avatarHtml = s.avatar_full
          ? '<img src="' + esc(s.avatar_full) + '" class="w-6 h-6 rounded-full object-cover shrink-0">'
          : '<div class="w-6 h-6 rounded-full shrink-0">' + letterAvatarRound(s.name, 24) + '</div>';
        var fearUrl = "https://fearproject.ru/profile/" + s.steamid;
        html += '<div class="flex items-center gap-2 py-1">';
        html += '<span class="text-gray-600 text-[10px] w-3 text-right">' + (i + 1) + '</span>';
        html += avatarHtml;
        html += '<a href="' + fearUrl + '" target="_blank" class="flex-1 min-w-0 text-[11px] text-white truncate hover:text-[#818cf8]">' + esc(s.name || s.steamid) + '</a>';
        html += '<span class="text-[11px] font-semibold shrink-0" style="color:' + color + '">' + valueFn(s) + '</span>';
        html += '</div>';
      }); }
      html += '</div>';
      return html;
    }
    var html = renderStaffMini(d.topKd, 'Топ K/D', function(s) { return s.kd; }, '#22c7aa');
    html += renderStaffMini(d.newestAccounts, 'Новые аккаунты', function(s) {
      if (!s.fear_created_at) return '-';
      return fmtAge(s.fear_created_at) || new Date(s.fear_created_at).toLocaleDateString("ru-RU");
    }, '#818cf8');
    html += renderStaffMini(d.lowestHours, 'Мало часов', function(s) { return fmtHours(s.playtime); }, '#e2bb6d');
    overviewEl.innerHTML = html;
  }).catch(function() { if (overviewEl) overviewEl.innerHTML = '<div class="col-span-3 text-gray-500 text-xs">Ошибка загрузки</div>'; });

  fetch("/api/admin/users").then(function(r){return r.json()}).then(function(data) {
    if (!usersEl) return;
    var users = data.users || [];
    if (!users.length) { usersEl.innerHTML = '<div class="text-gray-500 text-xs">Нет пользователей</div>'; return; }
    var html = '';
    users.forEach(function(u) {
      var lastLoginStr = u.last_login ? fmtDate(u.last_login) : '—';
      var lastIp = u.last_ip || '—';
      html += '<div class="flex items-center justify-between py-2.5 px-3 rounded-lg bg-white/[0.03]">';
      html += '<div class="flex-1 min-w-0"><div class="text-sm font-medium text-white truncate">' + esc(u.username) + '</div>';
      html += '<div class="text-[10px] text-gray-500 mt-0.5">' + esc(u.discord_name || '—') + ' · DiscordID: ' + esc(u.discord_id || '—') + '</div>';
      html += '<div class="text-[10px] text-gray-600 mt-0.5">IP: ' + esc(lastIp) + ' · Последний вход: ' + lastLoginStr + '</div>';
      html += '</div>';
      html += '<div class="flex items-center gap-2 shrink-0">';
      var roles = ['user','Мл. Модератор','Модератор','Модератор Discord','Модератор месяца','Ст. Модератор','Спец. Администратор','Ст. Администратор','Гл. Администратор','Разработчик','Куратор','Владелец'];
      html += '<select onchange="changeUserRole(' + u.id + ', this.value)" class="text-[10px] px-1 py-0.5 rounded bg-white/5 text-gray-400 w-[130px]">';
      roles.forEach(function(r) { html += '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + r + '</option>'; });
      html += '</select>';
      if (u.active_sessions > 0) html += '<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">' + u.active_sessions + ' сессия</span>';
      html += '<button onclick="deleteSiteUser(' + u.id + ', \'' + esc(u.username) + '\')" class="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors" title="Удалить"><i class="ph ph-trash"></i></button>';
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

// ===================== OWNER SETTINGS =====================
function loadOwnerSystem() {
  var el = document.getElementById("ownerSystemInfo");
  if (!el) return;
  el.innerHTML = '<div class="col-span-full text-center text-gray-500 text-xs py-2">Загрузка...</div>';
  fetch("/api/owner/system").then(function(r) {
    if (!r.ok) throw new Error("Нет доступа (403)");
    return r.json();
  }).then(function(d) {
    var dbSizeStr = d.dbSize ? (d.dbSize > 1048576 ? (d.dbSize / 1048576).toFixed(1) + " MB" : (d.dbSize / 1024).toFixed(1) + " KB") : "—";
    var uptimeH = Math.floor(d.uptime / 3600);
    var uptimeM = Math.floor((d.uptime % 3600) / 60);
    var uptimeStr = uptimeH + "ч " + uptimeM + "м";
    el.innerHTML = ''
      + '<div class="text-center p-3 rounded-xl bg-white/[0.03] border border-white/5"><div class="text-lg font-bold text-white">' + d.adminCount + '</div><div class="text-[10px] text-gray-500">Админов</div></div>'
      + '<div class="text-center p-3 rounded-xl bg-white/[0.03] border border-white/5"><div class="text-lg font-bold text-white">' + d.profilesCount + '</div><div class="text-[10px] text-gray-500">Профилей</div></div>'
      + '<div class="text-center p-3 rounded-xl bg-white/[0.03] border border-white/5"><div class="text-lg font-bold text-white">' + d.punishmentsCount + '</div><div class="text-[10px] text-gray-500">Наказаний</div></div>'
      + '<div class="text-center p-3 rounded-xl bg-white/[0.03] border border-white/5"><div class="text-lg font-bold text-white">' + d.usersCount + '</div><div class="text-[10px] text-gray-500">Пользователей</div></div>'
      + '<div class="text-center p-3 rounded-xl bg-white/[0.03] border border-white/5"><div class="text-lg font-bold text-emerald-400">' + d.totalAdminsOnline + '</div><div class="text-[10px] text-gray-500">Онлайн</div></div>'
      + '<div class="text-center p-3 rounded-xl bg-white/[0.03] border border-white/5"><div class="text-lg font-bold text-white">' + d.memoryMB + ' MB</div><div class="text-[10px] text-gray-500">Память</div></div>'
      + '<div class="text-center p-3 rounded-xl bg-white/[0.03] border border-white/5"><div class="text-lg font-bold text-white">' + dbSizeStr + '</div><div class="text-[10px] text-gray-500">БД</div></div>'
      + '<div class="text-center p-3 rounded-xl bg-white/[0.03] border border-white/5"><div class="text-lg font-bold text-white">' + uptimeStr + '</div><div class="text-[10px] text-gray-500">Аптайм</div></div>';
    el.innerHTML += '<div class="col-span-full flex flex-wrap gap-4 text-[10px] text-gray-600 mt-1"><span>Node ' + esc(d.nodeVersion || '—') + '</span><span>' + esc(d.siteUrl || '—') + '</span></div>';
    var btn = document.getElementById("techModeBtn");
    if (btn) {
      btn.innerHTML = d.techMode
        ? '<i class="ph ph-wrench"></i> Тех. работы: Вкл'
        : '<i class="ph ph-wrench"></i> Тех. работы: Выкл';
      if (d.techMode) { btn.classList.remove("bg-amber-500/15","border-amber-500/30","text-amber-400"); btn.classList.add("bg-emerald-500/15","border-emerald-500/30","text-emerald-400"); }
      else { btn.classList.remove("bg-emerald-500/15","border-emerald-500/30","text-emerald-400"); btn.classList.add("bg-amber-500/15","border-amber-500/30","text-amber-400"); }
    }
  }).catch(function(err) {
    el.innerHTML = '<div class="col-span-full text-center py-3"><div class="text-gray-500 text-xs">Настройки владельца</div><div class="text-red-400 text-[11px] mt-1">Нет доступа или ошибка загрузки</div></div>';
  });
}

function ownerShowResult(msg, ok) {
  var el = document.getElementById("ownerActionResult");
  if (!el) return;
  el.className = 'mt-3 text-xs px-3 py-2 rounded-lg ' + (ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(function() { el.classList.add('hidden'); }, 3000);
}

function ownerForceRefresh() {
  fetch("/api/owner/force-refresh", { method: "POST" }).then(function(r){return r.json()}).then(function(d) {
    if (d.ok) { ownerShowResult("Данные успешно обновлены!", true); loadOnlineAdmins(); loadDashboardStats(); }
    else ownerShowResult("Ошибка: " + (d.error || "unknown"), false);
  }).catch(function(e) { ownerShowResult("Ошибка: " + e.message, false); });
}

function ownerToggleTechMode() {
  fetch("/api/owner/tech-mode", { method: "POST" }).then(function(r){return r.json()}).then(function(d) {
    ownerShowResult("Тех. режим: " + (d.techMode ? "ВКЛ" : "ВЫКЛ"), true);
    loadOwnerSystem();
  }).catch(function(e) { ownerShowResult("Ошибка: " + e.message, false); });
}

// ===================== HIDE STATS =====================
function letterAvatar(name, size) {
  var letter = (name || "?").charAt(0).toUpperCase();
  var colors = ["#e74c3c","#e67e22","#f1c40f","#2ecc71","#1abc9c","#3498db","#9b59b6","#e91e63","#00bcd4","#ff5722"];
  var idx = 0;
  for (var i = 0; i < (name || "").length; i++) idx = (idx * 31 + (name || "").charCodeAt(i)) % colors.length;
  var bg = colors[idx];
  var s = size || 40;
  return '<div style="width:'+s+'px;height:'+s+'px;border-radius:8px;background:'+bg+';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:' + Math.round(s * 0.4) + 'px;">' + esc(letter) + '</div>';
}

function letterAvatarRound(name, size) {
  var letter = (name || "?").charAt(0).toUpperCase();
  var colors = ["#e74c3c","#e67e22","#f1c40f","#2ecc71","#1abc9c","#3498db","#9b59b6","#e91e63","#00bcd4","#ff5722"];
  var idx = 0;
  for (var i = 0; i < (name || "").length; i++) idx = (idx * 31 + (name || "").charCodeAt(i)) % colors.length;
  var bg = colors[idx];
  var s = size || 32;
  return '<div style="width:'+s+'px;height:'+s+'px;border-radius:50%;background:'+bg+';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:' + Math.round(s * 0.4) + 'px;">' + esc(letter) + '</div>';
}

var hideStatsModal = null;
var hiddenStaffList = [];

function openHideStatsModal() {
  if (!hideStatsModal) {
    hideStatsModal = document.createElement("div");
    hideStatsModal.id = "hideStatsModal";
    hideStatsModal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm hidden";
    hideStatsModal.innerHTML = '<div class="glass-panel rounded-2xl p-5 w-[420px] max-h-[500px] flex flex-col relative">'
      + '<button onclick="closeHideStatsModal()" class="absolute top-3 right-3 text-gray-500 hover:text-white"><i class="ph ph-x text-lg"></i></button>'
      + '<h3 class="text-sm font-bold text-white mb-3 flex items-center gap-2"><i class="ph ph-eye-slash text-[#5865F2]"></i> Скрыть из статистики</h3>'
      + '<input id="hideStatsSearch" type="text" placeholder="Поиск по имени или SteamID..." class="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#5865F2]/50 mb-3">'
      + '<div id="hideStatsList" class="flex-1 overflow-y-auto space-y-1"></div>'
      + '</div>';
    hideStatsModal.addEventListener("click", function(e) { if (e.target === hideStatsModal) closeHideStatsModal(); });
    document.body.appendChild(hideStatsModal);
    document.getElementById("hideStatsSearch").addEventListener("input", function() { renderHideStatsList(this.value); });
  }
  hideStatsModal.classList.remove("hidden");
  fetch("/api/hidden-staff").then(function(r) { return r.json(); }).then(function(d) {
    hiddenStaffList = d.hidden || [];
    renderHideStatsList("");
  }).catch(function() {
    hiddenStaffList = [];
    renderHideStatsList("");
  });
}

function closeHideStatsModal() {
  if (hideStatsModal) hideStatsModal.classList.add("hidden");
}

function renderHideStatsList(query) {
  var el = document.getElementById("hideStatsList");
  if (!el) return;
  var url = "/api/admins?limit=500&sortBy=admin_id&sortDir=DESC";
  if (query) url += "&search=" + encodeURIComponent(query);
  fetch(url).then(function(r) { return r.json(); }).then(function(d) {
    var rows = d.rows || [];
    if (!rows.length) { el.innerHTML = '<div class="text-center text-gray-500 text-xs py-4">Нет результатов</div>'; return; }
    var html = '';
    rows.forEach(function(r) {
      var isHidden = hiddenStaffList.indexOf(r.steamid) !== -1;
      var toggleClass = isHidden ? 'bg-red-500/15 border-red-500/30 text-red-400' : 'bg-white/5 border-white/10 text-gray-400';
      var toggleText = isHidden ? 'Скрыт' : 'Показать';
      var toggleIcon = isHidden ? 'ph-eye-slash' : 'ph-eye';
      html += '<div class="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.03]">';
      html += '<div class="flex items-center gap-2.5 min-w-0">';
      if (r.avatar_full) {
        html += '<img src="' + esc(r.avatar_full) + '" class="w-7 h-7 rounded-full object-cover">';
      } else {
        html += letterAvatarRound(r.name, 28);
      }
      html += '<div class="min-w-0"><div class="text-xs font-medium text-white truncate">' + esc(r.name || r.steamid) + '</div>';
      html += '<div class="text-[10px] text-gray-500 font-mono">' + esc(r.steamid) + '</div></div></div>';
      html += '<button onclick="toggleHideStaff(\'' + esc(r.steamid) + '\', ' + !isHidden + ')" class="px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-colors ' + toggleClass + '">';
      html += '<i class="ph ' + toggleIcon + ' mr-1"></i>' + toggleText + '</button></div>';
    });
    el.innerHTML = html;
  }).catch(function() {
    el.innerHTML = '<div class="text-center text-red-400 text-xs py-4">Ошибка загрузки</div>';
  });
}

function toggleHideStaff(steamid, shouldHide) {
  if (shouldHide) {
    fetch("/api/hidden-staff", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ steamid: steamid }) })
      .then(function(r) { return r.json(); }).then(function() {
        hiddenStaffList.push(steamid);
        var q = document.getElementById("hideStatsSearch");
        renderHideStatsList(q ? q.value : "");
      }).catch(function() {});
  } else {
    fetch("/api/hidden-staff/" + encodeURIComponent(steamid), { method: "DELETE" })
      .then(function(r) { return r.json(); }).then(function() {
        hiddenStaffList = hiddenStaffList.filter(function(s) { return s !== steamid; });
        var q = document.getElementById("hideStatsSearch");
        renderHideStatsList(q ? q.value : "");
      }).catch(function() {});
  }
}

var hideStatsBtn = document.getElementById("hideStatsBtn");
if (hideStatsBtn) {
  hideStatsBtn.addEventListener("click", function() { openHideStatsModal(); });
}

// ===================== TAB ACCESS CONTROL =====================
var TAB_NAMES = {
  online: 'Online', all: 'Все админы', stats: 'Статистика',
  logs: 'Логи', mystats: 'Мои наказания', adminpanel: 'Админка'
};
var ROLE_RANKS = [
  { rank: 7, label: 'Мл. Модератор' }, { rank: 8, label: 'Модератор' },
  { rank: 9, label: 'Ст. Модератор' }, { rank: 10, label: 'Спец. Администратор' },
  { rank: 11, label: 'Ст. Администратор' }, { rank: 12, label: 'Гл. Администратор' },
  { rank: 13, label: 'Разработчик' }, { rank: 14, label: 'Куратор' }, { rank: 15, label: 'Владелец' }
];

var cachedTabAccess = [];

function loadTabAccess() {
  var el = document.getElementById("tabAccessList");
  if (!el) return;
  fetch("/api/tab-access").then(function(r){return r.json()}).then(function(data) {
    cachedTabAccess = data.tabs || [];
    var html = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">';
    (data.tabs || []).forEach(function(t) {
      var name = TAB_NAMES[t.tab_id] || esc(String(t.tab_id));
      var selectedRank = ROLE_RANKS.find(function(r) { return r.rank === t.min_role_rank; });
      var selectedLabel = selectedRank ? selectedRank.label : 'Ранг ' + t.min_role_rank;
      html += '<div class="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.03] border border-white/5">';
      html += '<span class="text-sm text-white font-medium">' + name + '</span>';
      html += '<div class="flex items-center gap-2">';
      html += '<select onchange="updateTabAccessRank(\'' + esc(String(t.tab_id)) + '\', this.value)" class="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-300 outline-none">';
      ROLE_RANKS.forEach(function(r) {
        html += '<option value="' + r.rank + '"' + (r.rank === t.min_role_rank ? ' selected' : '') + '>' + r.label + '</option>';
      });
      html += '</select>';
      html += '<button onclick="toggleTabAccess(\'' + t.tab_id + '\', ' + t.min_role_rank + ', ' + !t.enabled + ')" class="w-10 h-5 rounded-full transition-colors ' + (t.enabled ? 'bg-emerald-500/30' : 'bg-white/10') + ' relative">';
      html += '<div class="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ' + (t.enabled ? 'left-5' : 'left-0.5') + '"></div>';
      html += '</button></div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }).catch(function() { el.innerHTML = '<div class="text-gray-500 text-xs">Ошибка загрузки</div>'; });
}

function toggleTabAccess(tabId, minRank, enabled) {
  fetch("/api/tab-access", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ tabId: tabId, minRoleRank: minRank, enabled: enabled }) })
    .then(function(r) { return r.json(); }).then(function() { loadTabAccess(); }).catch(function() {});
}

function updateTabAccessRank(tabId, newRank) {
  var currentTab = cachedTabAccess.find(function(t) { return t.tab_id === tabId; });
  var currentEnabled = currentTab ? currentTab.enabled : true;
  fetch("/api/tab-access", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ tabId: tabId, minRoleRank: parseInt(newRank), enabled: currentEnabled }) })
    .then(function(r) { return r.json(); }).then(function() { loadTabAccess(); }).catch(function() {});
}

// ===================== ROLE CHANGE =====================
function changeUserRole(userId, newRole) {
  fetch("/api/admin/users/" + userId + "/role", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ role: newRole }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      if (d.ok) { ownerShowResult("Роль обновлена", true); loadAdminPanel(); }
      else ownerShowResult("Ошибка: " + (d.error || "unknown"), false);
    }).catch(function() { ownerShowResult("Ошибка смены роли", false); });
}

// ===================== ANALYTICS =====================
function loadAnalytics() {
  fetch("/api/analytics/overview").then(function(r){return r.json()}).then(function(d) {
    var el = document.getElementById("analyticsStats");
    if (!el) return;
    el.innerHTML = ''
      + '<div class="text-center p-3 rounded-xl bg-white/[0.03] border border-white/5"><div class="text-lg font-bold text-emerald-400">' + (d.peakOnline || 0) + '</div><div class="text-[10px] text-gray-500">Пик онлайна</div></div>'
      + '<div class="text-center p-3 rounded-xl bg-white/[0.03] border border-white/5"><div class="text-lg font-bold text-blue-400">' + (d.avgOnline || 0) + '</div><div class="text-[10px] text-gray-500">Средний онлайн</div></div>'
      + '<div class="text-center p-3 rounded-xl bg-white/[0.03] border border-white/5"><div class="text-lg font-bold text-purple-400">' + (d.totalDrops || 0) + '</div><div class="text-[10px] text-gray-500">Всего дропов</div></div>'
      + '<div class="text-center p-3 rounded-xl bg-white/[0.03] border border-white/5"><div class="text-lg font-bold text-amber-400">' + (d.todayDrops || 0) + '</div><div class="text-[10px] text-gray-500">Дропов сегодня</div></div>';
  }).catch(function(){});
  loadAnalyticsOnlineChart();
  loadAnalyticsStaffTop();
  loadAnalyticsDropsSummary();
  loadAnalyticsDrops(0);
}

function loadAnalyticsOnlineChart() {
  fetch("/api/analytics/online-history").then(function(r){return r.json()}).then(function(d) {
    var el = document.getElementById("analyticsOnlineChart");
    if (!el) return;
    var points = d.points || [];
    if (!points.length) { el.innerHTML = '<div class="text-gray-500 text-xs text-center py-8">Нет данных</div>'; return; }
    var maxVal = Math.max.apply(null, points.map(function(p) { return p.online; })) || 1;
    var w = el.offsetWidth || 600;
    var h = 200;
    var step = w / Math.max(points.length - 1, 1);
    var svg = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">';
    svg += '<defs><linearGradient id="og" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5865F2" stop-opacity="0.3"/><stop offset="100%" stop-color="#5865F2" stop-opacity="0"/></linearGradient></defs>';
    var pathD = '';
    var areaD = 'M0,' + h;
    points.forEach(function(p, i) {
      var x = i * step;
      var y = h - (p.online / maxVal) * (h - 20) - 10;
      if (i === 0) { pathD += 'M' + x + ',' + y; areaD += ' L' + x + ',' + y; }
      else { pathD += ' L' + x + ',' + y; areaD += ' L' + x + ',' + y; }
    });
    areaD += ' L' + ((points.length - 1) * step) + ',' + h + ' Z';
    svg += '<path d="' + areaD + '" fill="url(#og)"/>';
    svg += '<path d="' + pathD + '" fill="none" stroke="#5865F2" stroke-width="2"/>';
    points.forEach(function(p, i) {
      if (i % Math.ceil(points.length / 10) === 0 || i === points.length - 1) {
        var x = i * step;
        var y = h - (p.online / maxVal) * (h - 20) - 10;
        svg += '<circle cx="' + x + '" cy="' + y + '" r="3" fill="#5865F2"/>';
        svg += '<text x="' + x + '" y="' + (h - 2) + '" fill="#6b7280" font-size="9" text-anchor="middle">' + esc(p.label || '') + '</text>';
      }
    });
    svg += '</svg>';
    el.innerHTML = svg;
  }).catch(function() { var el = document.getElementById("analyticsOnlineChart"); if (el) el.innerHTML = '<div class="text-red-400 text-xs text-center py-8">Ошибка</div>'; });
}

function loadAnalyticsStaffTop() {
  fetch("/api/analytics/staff-top").then(function(r){return r.json()}).then(function(d) {
    var el = document.getElementById("analyticsStaffTop");
    if (!el) return;
    var rows = d.rows || [];
    if (!rows.length) { el.innerHTML = '<div class="text-gray-500 text-xs">Нет данных</div>'; return; }
    var html = '';
    rows.slice(0, 10).forEach(function(r, i) {
      var medals = ['🥇','🥈','🥉'];
      var medal = i < 3 ? medals[i] : '<span class="text-gray-600">' + (i+1) + '</span>';
      html += '<div class="flex items-center gap-2 py-1.5 px-2 rounded bg-white/[0.03] text-xs">';
      html += '<span class="w-6 text-center">' + medal + '</span>';
      html += '<span class="flex-1 text-white truncate">' + esc(r.name || r.steamid) + '</span>';
      html += '<span class="text-gray-500">' + r.bans + 'Б/' + r.mutes + 'М</span>';
      html += '</div>';
    });
    el.innerHTML = html;
  }).catch(function() {});
}

function loadAnalyticsDropsSummary() {
  fetch("/api/analytics/drops-summary").then(function(r){return r.json()}).then(function(d) {
    var el = document.getElementById("analyticsDrops");
    if (!el) return;
    el.innerHTML = ''
      + '<div class="space-y-2">'
      + '<div class="flex items-center justify-between text-xs"><span class="text-gray-400">Всего скинов</span><span class="text-white font-bold">' + (d.totalSkins || 0) + '</span></div>'
      + '<div class="flex items-center justify-between text-xs"><span class="text-gray-400">Игрокам</span><span class="text-white font-bold">' + (d.totalPlayers || 0) + '</span></div>'
      + '<div class="flex items-center justify-between text-xs"><span class="text-gray-400">Суммарная стоимость</span><span class="text-amber-400 font-bold">$' + (d.totalValue || 0) + '</span></div>'
      + '<div class="flex items-center justify-between text-xs"><span class="text-gray-400">Сегодня скинов</span><span class="text-purple-400 font-bold">' + (d.todaySkins || 0) + '</span></div>'
      + '<div class="flex items-center justify-between text-xs"><span class="text-gray-400">Сегодня игрокам</span><span class="text-purple-400 font-bold">' + (d.todayPlayers || 0) + '</span></div>'
      + '</div>';
  }).catch(function() {});
}

var analyticsDropPage = 0;
function loadAnalyticsDrops(period) {
  analyticsDropPage = 0;
  document.querySelectorAll('#tab-analytics [id^="dropsDayBtn"],#tab-analytics [id^="dropsWeekBtn"],#tab-analytics [id^="dropsMonthBtn"]').forEach(function(b) {
    b.className = 'px-3 py-1 rounded-lg text-[11px] font-medium border border-white/10 text-gray-500';
  });
  var btnId = period === 0 ? 'dropsDayBtn' : period === 1 ? 'dropsWeekBtn' : 'dropsMonthBtn';
  var btn = document.getElementById(btnId);
  if (btn) btn.className = 'px-3 py-1 rounded-lg text-[11px] font-medium border border-[#5865F2]/40 bg-[#5865F2]/20 text-[#818cf8]';
  fetchAnalyticsDropsPage(period, 0);
}

function fetchAnalyticsDropsPage(period, page) {
  var el = document.getElementById("analyticsDropList");
  if (!el) return;
  fetch("/api/analytics/drops?period=" + period + "&page=" + page).then(function(r){return r.json()}).then(function(d) {
    var drops = d.drops || [];
    var total = d.total || 0;
    var totalPages = Math.ceil(total / 20);
    if (!drops.length) { el.innerHTML = '<div class="text-gray-500 text-xs text-center py-4">Нет дропов</div>'; return; }
    var html = '<div class="space-y-1">';
    drops.forEach(function(r) {
      html += '<div class="flex items-center gap-2 py-1.5 px-2 rounded bg-white/[0.03] text-[11px]">';
      html += '<span class="shrink-0 w-[130px] text-gray-500 font-mono">' + fmtTs(r.created_at) + '</span>';
      html += '<span class="shrink-0 text-white truncate max-w-[120px]">' + esc(r.player_name || r.steamid) + '</span>';
      html += '<span class="flex-1 min-w-0 text-gray-400 truncate">' + esc(r.skin_name || '—') + '</span>';
      html += '<span class="shrink-0 text-amber-400">$' + (r.price || 0) + '</span>';
      html += '</div>';
    });
    html += '</div>';
    if (totalPages > 1) {
      html += '<div class="flex items-center justify-center gap-2 mt-3">';
      if (page > 0) html += '<button onclick="fetchAnalyticsDropsPage(' + period + ',' + (page - 1) + ')" class="px-2 py-1 rounded bg-white/5 text-[10px] text-gray-400 hover:bg-white/10">←</button>';
      html += '<span class="text-[10px] text-gray-600">' + (page + 1) + '/' + totalPages + '</span>';
      if (page < totalPages - 1) html += '<button onclick="fetchAnalyticsDropsPage(' + period + ',' + (page + 1) + ')" class="px-2 py-1 rounded bg-white/5 text-[10px] text-gray-400 hover:bg-white/10">→</button>';
      html += '</div>';
    }
    el.innerHTML = html;
  }).catch(function() { if (el) el.innerHTML = '<div class="text-red-400 text-xs">Ошибка</div>'; });
}

// ===================== ALL PLAYERS TAB =====================
var playersPage = 0;
var playersPageSize = 30;
var playersTotal = 0;
var playersLoading = false;
var playersSearchQuery = "";

function loadAllPlayersTab() {
  loadAllPlayers(true);
  loadUnconfigured();
  loadActiveReports();
}

function renderPlayerCard(p) {
  var steamId = p.steamid;
  var name = p.name || steamId;
  var avatar = p.avatar_full || "";
  var kills = p.kills || 0;
  var deaths = p.deaths || 0;
  var kd = deaths > 0 ? (kills / deaths).toFixed(2) : (kills > 0 ? kills + "/0" : "-");
  var fearUrl = "https://fearproject.ru/profile/" + steamId;
  var steamUrl = "https://steamcommunity.com/profiles/" + steamId;
  var regDate = p.fear_created_at ? new Date(p.fear_created_at < 1e12 ? p.fear_created_at * 1000 : p.fear_created_at) : null;
  var regStr = regDate && !isNaN(regDate.getTime()) ? regDate.toLocaleDateString("ru-RU") + " в " + regDate.toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"}) : null;
  var regAge = regDate ? fmtAge(p.fear_created_at) : null;
  var groupLabel = p.group_display_name || p.group_name || null;

  var html = '<div class="rounded-xl bg-white/[0.03] border border-white/5 p-3 hover:border-white/10 transition-colors">';
  html += '<div class="flex items-start gap-3">';
  html += '<a href="' + fearUrl + '" target="_blank" class="relative shrink-0 block">';
  if (avatar) {
    html += '<img src="' + esc(avatar) + '" class="w-11 h-11 rounded-lg object-cover" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
    html += '<div class="w-11 h-11 rounded-lg bg-white/10 items-center justify-center hidden">' + letterAvatar(name, 44) + '</div>';
  } else {
    html += letterAvatar(name, 44);
  }
  html += '</a>';
  html += '<div class="flex-1 min-w-0">';
  html += '<a href="' + fearUrl + '" target="_blank" class="text-sm font-semibold text-white truncate block hover:text-[#818cf8] transition-colors">' + esc(name) + '</a>';
  html += '<div class="text-[10px] text-gray-500 font-mono mt-0.5">' + esc(steamId) + '</div>';
  if (regStr) {
    html += '<div class="flex items-center gap-1 mt-1">';
    html += '<i class="ph ph-clock text-gray-600 text-[10px]"></i>';
    html += '<span class="text-[10px] text-gray-500">' + esc(regStr) + '</span>';
    if (regAge) html += '<span class="text-[10px] text-gray-600">(' + regAge + ')</span>';
    html += '</div>';
  }
  html += '</div>';
  if (groupLabel) html += '<span class="tag shrink-0" style="background:' + (roleColor(groupLabel) || '#6b7280') + '18;color:' + (roleColor(groupLabel) || '#6b7280') + '">' + esc(groupLabel) + '</span>';
  html += '</div>';
  html += '<div class="grid grid-cols-3 gap-2 mt-3">';
  html += '<div class="text-center py-1.5 rounded-lg bg-white/[0.03]"><div class="text-[11px] font-bold text-emerald-400">' + kills + '</div><div class="text-[9px] text-gray-600">Убийства</div></div>';
  html += '<div class="text-center py-1.5 rounded-lg bg-white/[0.03]"><div class="text-[11px] font-bold text-red-400">' + deaths + '</div><div class="text-[9px] text-gray-600">Смерти</div></div>';
  html += '<div class="text-center py-1.5 rounded-lg bg-white/[0.03]"><div class="text-[11px] font-bold text-white">' + kd + '</div><div class="text-[9px] text-gray-600">K/D</div></div>';
  html += '</div>';
  html += '<div class="flex items-center gap-1.5 mt-2">';
  html += '<a href="' + steamUrl + '" target="_blank" class="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-gray-400 hover:text-white text-center transition-colors font-medium">Steam</a>';
  html += '<a href="' + fearUrl + '" target="_blank" class="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-gray-400 hover:text-white text-center transition-colors font-medium">Fear</a>';
  html += '<button onclick="copyToClipboard(\'' + esc(steamId) + '\', this)" class="py-1.5 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-gray-400 hover:text-white transition-colors" title="SteamID"><i class="ph ph-copy"></i></button>';
  html += '</div>';
  html += '</div>';
  return html;
}

function renderUnconfiguredCard(p) {
  var steamId = p.steamid;
  var name = p.name || steamId;
  var fearUrl = "https://fearproject.ru/profile/" + steamId;
  var steamUrl = "https://steamcommunity.com/profiles/" + steamId;
  var regDate = p.fear_created_at ? new Date(p.fear_created_at < 1e12 ? p.fear_created_at * 1000 : p.fear_created_at) : null;
  var regStr = regDate && !isNaN(regDate.getTime()) ? regDate.toLocaleDateString("ru-RU") + " в " + regDate.toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"}) : '-';
  var regAge = regDate ? fmtAge(p.fear_created_at) : null;

  var html = '<div class="rounded-xl bg-white/[0.03] border border-amber-500/20 p-3">';
  html += '<div class="flex items-start gap-2.5">';
  html += letterAvatar(name, 36);
  html += '<div class="flex-1 min-w-0">';
  html += '<div class="text-xs font-semibold text-white truncate">' + esc(name) + '</div>';
  html += '<div class="text-[9px] text-gray-500 font-mono">' + esc(steamId) + '</div>';
  html += '<div class="flex items-center gap-1 mt-1"><i class="ph ph-clock text-gray-600 text-[9px]"></i><span class="text-[9px] text-gray-500">' + esc(regStr) + (regAge ? ' (' + regAge + ')' : '') + '</span></div>';
  html += '</div></div>';
  html += '<div class="flex items-center gap-1 mt-2">';
  html += '<a href="' + steamUrl + '" target="_blank" class="flex-1 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[9px] text-gray-400 hover:text-white text-center transition-colors">Steam</a>';
  html += '<a href="' + fearUrl + '" target="_blank" class="flex-1 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[9px] text-gray-400 hover:text-white text-center transition-colors">Fear</a>';
  html += '</div></div>';
  return html;
}

function renderReportCard(r) {
  var id = r.id || r.ticket_id || '?';
  var reporter = r.reporter_name || r.sender_name || r.reporter || '—';
  var violator = r.violator_name || r.name || r.violator || '—';
  var reason = r.reason || r.ticket_reason || '—';
  var server = r.server_name || r.server || '';
  var created = r.created_at || r.date || r.created;
  var createdStr = '';
  if (created) {
    var d = new Date(created < 1e12 ? created * 1000 : created);
    if (!isNaN(d.getTime())) createdStr = d.toLocaleDateString("ru-RU") + ' ' + d.toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"});
  }

  var html = '<div class="rounded-xl bg-white/[0.03] border border-white/5 p-3 hover:border-amber-500/20 transition-colors">';
  html += '<div class="flex items-center justify-between mb-2">';
  html += '<span class="text-[11px] font-bold text-amber-400">#' + esc(String(id)) + '</span>';
  if (createdStr) html += '<span class="text-[9px] text-gray-600 font-mono">' + esc(createdStr) + '</span>';
  html += '</div>';
  html += '<div class="text-[11px] text-gray-300 mb-1"><span class="text-gray-500">От:</span> ' + esc(reporter) + '</div>';
  html += '<div class="text-[11px] text-gray-300 mb-1"><span class="text-gray-500">Нарушитель:</span> ' + esc(violator) + '</div>';
  html += '<div class="text-[10px] text-gray-400 mb-2 truncate" title="' + esc(reason) + '"><span class="text-gray-500">Причина:</span> ' + esc(reason) + '</div>';
  if (server) html += '<div class="text-[9px] text-gray-600 mb-2"><i class="ph ph-server mr-1"></i>' + esc(server) + '</div>';
  html += '<div class="flex gap-1.5">';
  html += '<select id="reportVerdict_' + esc(String(id)) + '" class="flex-1 text-[10px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-gray-400">';
  html += '<option value="punished">Игрок наказан</option>';
  html += '<option value="not_confirmed">Не подтверждено</option>';
  html += '<option value="insufficient">Недостаточно доказательств</option>';
  html += '<option value="needs_check">Доп. проверка</option>';
  html += '</select>';
  html += '</div>';
  html += '<input type="text" id="reportNote_' + esc(String(id)) + '" placeholder="Комментарий..." class="w-full mt-1.5 text-[10px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#5865F2]/50">';
  html += '</div>';
  return html;
}

function loadAllPlayers(reset) {
  if (playersLoading) return;
  playersLoading = true;
  var listEl = document.getElementById("allPlayersList");
  var pagingEl = document.getElementById("allPlayersPaging");
  var totalEl = document.getElementById("allPlayersTotal");
  if (reset) {
    playersPage = 0;
    playersTotal = 0;
    listEl.innerHTML = '<div class="space-y-2"><div class="skeleton h-[120px]"></div><div class="skeleton h-[120px]"></div><div class="skeleton h-[120px]"></div></div>';
    pagingEl.textContent = "";
  }
  var offset = playersPage * playersPageSize;
  var url = "/api/all-profiles?limit=" + playersPageSize + "&offset=" + offset + "&sortBy=created_at&sortDir=DESC";
  if (playersSearchQuery) url += "&search=" + encodeURIComponent(playersSearchQuery);
  fetch(url).then(function(r){return r.json()}).then(function(data) {
    playersLoading = false;
    playersTotal = data.total || 0;
    var rows = data.rows || [];
    if (reset) listEl.innerHTML = "";
    if (!rows.length && reset) { listEl.innerHTML = '<div class="text-center text-gray-500 text-xs py-8">Нет игроков</div>'; return; }
    var fragment = document.createDocumentFragment();
    rows.forEach(function(r) { var d = document.createElement("div"); d.innerHTML = renderPlayerCard(r); fragment.appendChild(d.firstElementChild); });
    listEl.appendChild(fragment);
    playersPage++;
    if (pagingEl) pagingEl.textContent = Math.min(playersPage * playersPageSize, playersTotal) + " / " + playersTotal;
    if (totalEl) totalEl.textContent = playersTotal;
  }).catch(function(err) {
    playersLoading = false;
    listEl.innerHTML = '<div class="text-center text-red-400 text-xs py-4">Ошибка: ' + esc(err.message) + '</div>';
  });
}

function loadUnconfigured() {
  var el = document.getElementById("unconfiguredList");
  var totalEl = document.getElementById("unconfiguredTotal");
  el.innerHTML = '<div class="space-y-2"><div class="skeleton h-[80px]"></div><div class="skeleton h-[80px]"></div></div>';
  fetch("/api/unconfigured-profiles").then(function(r){return r.json()}).then(function(d) {
    var profiles = d.profiles || [];
    totalEl.textContent = profiles.length;
    if (!profiles.length) { el.innerHTML = '<div class="text-center text-gray-500 text-[11px] py-4">Все настроены</div>'; return; }
    el.innerHTML = profiles.map(function(p) { return renderUnconfiguredCard(p); }).join("");
  }).catch(function() { el.innerHTML = '<div class="text-center text-gray-500 text-[11px] py-4">Ошибка</div>'; });
}

function loadActiveReports() {
  var el = document.getElementById("reportsList");
  var totalEl = document.getElementById("reportsTotal");
  el.innerHTML = '<div class="space-y-2"><div class="skeleton h-[100px]"></div><div class="skeleton h-[100px]"></div></div>';
  fetch("/api/active-reports").then(function(r){return r.json()}).then(function(d) {
    var reports = d.reports || [];
    totalEl.textContent = reports.length;
    if (!reports.length) { el.innerHTML = '<div class="text-center text-gray-500 text-[11px] py-4">Нет активных репортов</div>'; return; }
    el.innerHTML = reports.map(function(r) { return renderReportCard(r); }).join("");
  }).catch(function() { el.innerHTML = '<div class="text-center text-gray-500 text-[11px] py-4">Ошибка загрузки</div>'; });
}

var playersSearchTimeout = null;
var playersSearchInput = document.getElementById("allPlayersSearch");
if (playersSearchInput) {
  playersSearchInput.addEventListener("input", function() {
    clearTimeout(playersSearchTimeout);
    var q = this.value.trim();
    playersSearchTimeout = setTimeout(function() {
      playersSearchQuery = q;
      loadAllPlayers(true);
    }, 300);
  });
}

// Auto-refresh admin panel every 30s
setInterval(function() {
  var adminTab = document.getElementById("tab-adminpanel");
  if (adminTab && adminTab.classList.contains("active")) {
    loadAdminPanel();
    loadOwnerSystem();
  }
}, 30000);
