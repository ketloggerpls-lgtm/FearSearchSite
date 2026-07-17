fetch("/api/auth/me").then(function(r) {
  if (r.status === 401) window.location.href = "/login";
}).catch(function() {});

const refreshBtn = document.getElementById("refreshBtn");
const statusEl = document.getElementById("status");
const rowsEl = document.getElementById("rows");
const paginationEl = document.getElementById("pagination");
const searchInput = document.getElementById("searchInput");
const onlineListEl = document.getElementById("onlineList");
const onlineCountEl = document.getElementById("onlineCount");
const allCountEl = document.getElementById("allCount");
const onlineStatusEl = document.getElementById("onlineStatus");

const PAGE_SIZE = 50;
let currentPage = 0;
let totalRows = 0;
let loading = false;
let searchTimeout = null;
let currentSort = "admin_id";
let currentSortDir = "DESC";
let adminsLoaded = false;

function fmtDate(value) {
  if (!value) return "-";
  try { return new Date(value).toLocaleString("ru-RU"); } catch { return "-"; }
}

function fmtHours(seconds) {
  if (seconds == null || seconds === 0) return "-";
  const h = Number(seconds) / 3600;
  if (h >= 1) return h.toFixed(1) + "\u0447";
  return Math.round(Number(seconds) / 60) + "\u043c";
}

function fmtAge(created_at) {
  if (!created_at) return "-";
  try {
    const d = new Date(created_at);
    if (isNaN(d.getTime())) return "-";
    const now = new Date();
    const days = Math.floor((now - d) / 86400000);
    if (days < 1) return today_str(d);
    if (days < 30) return days + "\u0434";
    if (days < 365) return Math.floor(days / 30) + "\u043c";
    return Math.floor(days / 365) + "\u0433 " + Math.floor((days % 365) / 30) + "\u043c";
  } catch { return "-"; }
}

function fmtDateShort(created_at) {
  if (!created_at) return "-";
  try {
    const d = new Date(created_at);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("ru-RU");
  } catch { return "-"; }
}

function today_str(d) {
  return d.toLocaleDateString("ru-RU");
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function teamLabel(team) {
  if (!team || team === "none" || team === "HIDE") return '<span class="text-gray-500">None</span>';
  const colors = { CT: "text-blue-400", T: "text-amber-400", SPEC: "text-purple-400" };
  return '<span class="' + (colors[team] || 'text-gray-400') + '">' + escapeHtml(team) + "</span>";
}

function faceitBadge(level, elo) {
  if (level == null) return '<span class="text-gray-600">-</span>';
  const color = level >= 10 ? "text-orange-400" : level >= 7 ? "text-purple-400" : level >= 4 ? "text-blue-400" : "text-gray-400";
  var html = '<span class="' + color + ' font-semibold">LVL ' + level + "</span>";
  if (elo) html += '<span class="text-gray-600 text-xs ml-1">(' + elo + ")</span>";
  return html;
}

function setStatus(text, isError) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.className = isError ? "text-rose-400" : "text-emerald-400";
}

function renderRow(row) {
  var kd;
  if (row.kills != null && row.deaths != null && row.deaths > 0) {
    kd = (row.kills / row.deaths).toFixed(2);
  } else if (row.kills != null) {
    kd = row.kills + "/0";
  } else {
    kd = "-";
  }
  var frozenStatus = row.is_frozen
    ? '<span class="px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">\u0437\u0430\u043c\u043e\u0440\u043e\u0436\u0435\u043d</span>'
    : '<span class="px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-gray-500">\u0430\u043a\u0442\u0438\u0432\u0435\u043d</span>';
  var banStatus = row.ban_is_banned
    ? '<span class="px-2 py-0.5 rounded text-xs font-medium bg-rose-500/20 text-rose-400">\u0437\u0430\u0431\u0430\u043d\u0435\u043d</span>'
    : '<span class="px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-gray-500">\u0447\u0438\u0441\u0442\u043e</span>';

  var steamid = escapeHtml(row.steamid);
  var steamProfile = "https://steamcommunity.com/profiles/" + steamid;
  var fearProfile = "https://fearproject.ru/profile/" + steamid;

  var faceit = row.faceit_level != null
    ? '<a href="https://www.faceit.com/en/players/' + steamid + '" target="_blank" class="hover:underline">' + faceitBadge(row.faceit_level, row.faceit_elo) + "</a>"
    : faceitBadge(null, null);

  var links = '<div class="flex items-center gap-1.5">'
    + '<a href="' + fearProfile + '" target="_blank" title="Fear Profile" class="p-1 rounded hover:bg-white/10 transition-colors"><i class="ph ph-user text-gray-400 hover:text-white text-sm"></i></a>'
    + '<a href="' + steamProfile + '" target="_blank" title="Steam Profile" class="p-1 rounded hover:bg-white/10 transition-colors"><i class="ph ph-steam-logo text-gray-400 hover:text-white text-sm"></i></a>'
    + "</div>";

  var tr = document.createElement("tr");
  tr.className = "border-t border-white/5 hover:bg-white/[0.04] transition-colors";
  tr.innerHTML =
    '<td class="px-3 py-3"><img src="' + escapeHtml(row.avatar_full || "") + '" alt="" class="w-8 h-8 rounded-full"></td>'
    + '<td class="px-3 py-3 text-white font-medium">' + escapeHtml(row.name || "-") + "</td>"
    + '<td class="px-3 py-3 font-mono text-gray-400 text-xs">' + steamid + "</td>"
    + '<td class="px-3 py-3 text-gray-300">' + escapeHtml(row.group_display_name || row.group_name || "-") + "</td>"
    + '<td class="px-3 py-3">' + frozenStatus + "</td>"
    + '<td class="px-3 py-3 text-gray-300">' + escapeHtml(row.discord_nickname || "-") + "</td>"
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
  var url = "/api/admins?limit=" + PAGE_SIZE + "&offset=" + offset + "&sortBy=" + currentSort + "&sortDir=" + currentSortDir + (search ? "&search=" + encodeURIComponent(search) : "");

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

// Sorting
document.querySelectorAll(".sort-btn").forEach(function(btn) {
  btn.addEventListener("click", function() {
    var col = btn.dataset.sort;
    if (currentSort === col) {
      currentSortDir = currentSortDir === "DESC" ? "ASC" : "DESC";
    } else {
      currentSort = col;
      currentSortDir = col === "playtime" ? "DESC" : "DESC";
    }
    document.querySelectorAll(".sort-btn").forEach(function(b) { b.classList.remove("active"); });
    document.querySelectorAll(".sort-arrow").forEach(function(a) { a.textContent = ""; });
    btn.classList.add("active");
    var arrow = document.getElementById("arrow-" + col);
    if (arrow) arrow.textContent = currentSortDir === "ASC" ? "\u25b2" : "\u25bc";
    loadPage(true);
  });
});

// Infinite scroll
var observer = new IntersectionObserver(function(entries) {
  entries.forEach(function(entry) {
    if (entry.isIntersecting && !loading) loadPage(false);
  });
}, { rootMargin: "200px" });

// Search
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

// Online admins
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

    onlineListEl.innerHTML = unique.map(function(p) {
      var s = p._server;
      var playtime = p.db_playtime != null ? fmtHours(p.db_playtime) : "";
      var age = p.db_fear_created_at ? fmtAge(p.db_fear_created_at) : "";
      var faceit = p.db_faceit_level != null ? "Faceit LVL " + p.db_faceit_level : "";
      var connectUrl = "steam://connect/" + s.ip + ":" + s.port;
      var team = !p.team || p.team === "none" ? "None" : p.team;
      var teamColors = { CT: "text-blue-400", T: "text-amber-400", SPEC: "text-purple-400" };
      var teamCls = teamColors[team] || "text-gray-500";

      return '<div class="online-card flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">'
        + '<img src="' + escapeHtml(p.db_avatar || p.avatar || "") + '" alt="" class="w-8 h-8 rounded-full">'
        + '<div class="flex flex-col min-w-0">'
        + '<div class="flex items-center gap-2">'
        + '<span class="text-sm text-emerald-300 font-medium truncate">' + escapeHtml(p.db_name || p.nickname || p.steam_id) + "</span>"
        + '<span class="text-xs ' + teamCls + '">' + team + "</span>"
        + "</div>"
        + '<div class="flex items-center gap-2 text-xs text-gray-500">'
        + "<span>" + escapeHtml(s.site_name || s.domain || "") + "</span>"
        + (playtime ? " <span>\u00b7 " + playtime + "</span>" : "")
        + (age ? " <span>\u00b7 " + age + " \u043d\u0430 \u0441\u0430\u0439\u0442\u0435</span>" : "")
        + (faceit ? " <span>\u00b7 " + faceit + "</span>" : "")
        + "</div></div>"
        + '<a href="' + connectUrl + '" class="ml-auto shrink-0 px-2 py-1 rounded bg-[#5865F2]/20 hover:bg-[#5865F2]/40 text-[#5865F2] text-xs font-medium transition-colors flex items-center gap-1" title="\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c\u0441\u044f"><i class="ph ph-plugs"></i> Connect</a>'
        + '<a href="https://fearproject.ru/profile/' + escapeHtml(p.steam_id) + '" target="_blank" class="shrink-0 p-1 rounded hover:bg-white/10 transition-colors" title="Fear Profile"><i class="ph ph-user text-gray-400 hover:text-white text-sm"></i></a>'
        + '<a href="https://steamcommunity.com/profiles/' + escapeHtml(p.steam_id) + '" target="_blank" class="shrink-0 p-1 rounded hover:bg-white/10 transition-colors" title="Steam Profile"><i class="ph ph-steam-logo text-gray-400 hover:text-white text-sm"></i></a>'
        + "</div>";
    }).join("");
  } catch (error) {
    if (onlineStatusEl) onlineStatusEl.textContent = "\u041e\u0448\u0438\u0431\u043a\u0430";
    onlineListEl.innerHTML = '<span class="text-gray-500 text-sm">\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c</span>';
  }
}

// Status
async function loadStatus() {
  try {
    var response = await fetch("/api/refresh-status");
    var data = await response.json();
    setStatus(data.refreshInProgress ? "\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u0432 \u043f\u0440\u043e\u0446\u0435\u0441\u0441\u0435..." : "\u0413\u043e\u0442\u043e\u0432\u043e");
  } catch (_) {}
}

if (refreshBtn) {
  refreshBtn.addEventListener("click", async function() {
    try {
      setStatus("\u0417\u0430\u043f\u0443\u0441\u043a\u0430\u044e \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435...");
      var response = await fetch("/api/refresh", { method: "POST" });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || "\u041e\u0448\u0438\u0431\u043a\u0430");
      setStatus("\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u0437\u0430\u043f\u0443\u0449\u0435\u043d\u043e");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

setInterval(loadStatus, 5000);
setInterval(loadOnlineAdmins, 15000);
loadStatus();
loadOnlineAdmins();

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async function() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  });
}
