const rowsEl = document.getElementById("rows");
const metaEl = document.getElementById("meta");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const resetBtn = document.getElementById("resetBtn");
const paginationEl = document.getElementById("pagination");

let currentPage = 1;
const PAGE_SIZE = 50;

function fmtDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fearBadge(row) {
  if (row.fear_banned) return `<span class="badge badge-red">ЗАБАНЕН</span>`;
  return `<span class="badge badge-green">OK</span>`;
}

function vacBadge(row) {
  if (row.vac_banned) {
    const days = row.vac_days_ago != null ? `${row.vac_days_ago}д` : "";
    return `<span class="badge badge-red">VAC ${days}</span>`;
  }
  if (row.game_bans > 0) return `<span class="badge badge-yellow">Game ${row.game_bans}</span>`;
  return `<span class="badge badge-green">Clean</span>`;
}

function yoomaBadge(row) {
  if (row.yooma_banned) return `<span class="badge badge-red">БАН</span>`;
  return `<span class="badge badge-gray">-</span>`;
}

function renderRows(rows) {
  if (!rows.length) {
    rowsEl.innerHTML = `<tr><td colspan="9" class="px-4 py-12 text-center text-gray-500">Ничего не найдено</td></tr>`;
    return;
  }
  rowsEl.innerHTML = rows.map((r, i) => {
    const reason = r.fear_reason || r.yooma_reason || "-";
    const fileLink = r.attachment_url
      ? `<a href="${escapeHtml(r.attachment_url)}" target="_blank" class="text-[#a5b4fc] hover:underline text-xs">Скачать .vdf</a>`
      : (r.filename || "-");
    const msgLink = r.message_url
      ? `<a href="${escapeHtml(r.message_url)}" target="_blank" class="text-[#a5b4fc] hover:underline text-xs ml-1">Discord</a>`
      : "";
    return `<tr class="border-t border-white/5 hover:bg-white/[0.04] transition-colors">
      <td class="px-4 py-3 font-mono text-[#5865F2]">#${r.check_id || r.id}</td>
      <td class="px-4 py-3 text-gray-300">${fmtDate(r.created_at)}</td>
      <td class="px-4 py-3 font-mono text-gray-400 text-xs">${escapeHtml(r.steamid)}</td>
      <td class="px-4 py-3 text-white font-medium">${escapeHtml(r.nickname || '-')}</td>
      <td class="px-4 py-3">${r.fear_banned ? `<span class="px-2 py-0.5 rounded text-xs font-medium bg-rose-500/20 text-rose-400">ЗАБАНЕН</span>` : `<span class="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400">OK</span>`}</td>
      <td class="px-4 py-3">${r.vac_banned ? `<span class="px-2 py-0.5 rounded text-xs font-medium bg-rose-500/20 text-rose-400">VAC ${r.vac_days_ago != null ? r.vac_days_ago + 'д' : ''}</span>` : (r.game_bans > 0 ? `<span class="px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">Game ${r.game_bans}</span>` : `<span class="px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-gray-500">—</span>`)}</td>
      <td class="px-4 py-3">${r.yooma_banned ? `<span class="px-2 py-0.5 rounded text-xs font-medium bg-rose-500/20 text-rose-400">БАН</span>` : `<span class="px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-gray-500">—</span>`}</td>
      <td class="px-4 py-3 text-gray-400 text-xs" title="${escapeHtml(reason)}">${escapeHtml(reason.length > 50 ? reason.slice(0, 50) + '...' : reason)}</td>
      <td class="px-4 py-3">${fileLink} ${msgLink}</td>
    </tr>`;
  }).join("");
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function renderPagination(total, page) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) { paginationEl.innerHTML = ""; return; }
  let html = "";
  if (page > 1) html += `<button onclick="goPage(${page - 1})" class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium transition-colors">← Назад</button>`;
  html += `<span class="text-sm text-gray-400 px-2">Стр. ${page} из ${totalPages}</span>`;
  if (page < totalPages) html += `<button onclick="goPage(${page + 1})" class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium transition-colors">Вперёд →</button>`;
  paginationEl.innerHTML = html;
}

window.goPage = function(p) {
  currentPage = p;
  loadData();
};

async function loadData() {
  const search = searchInput.value.trim();
  const url = `/api/vdf-history?page=${currentPage}&limit=${PAGE_SIZE}${search ? "&search=" + encodeURIComponent(search) : ""}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    renderRows(data.rows || []);
    renderPagination(data.total || 0, data.page || 1);
    metaEl.textContent = `Всего записей: ${data.total || 0}`;
  } catch (e) {
    metaEl.textContent = "Ошибка загрузки: " + e.message;
    metaEl.style.color = "#f85149";
  }
}

searchBtn.addEventListener("click", () => { currentPage = 1; loadData(); });
searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { currentPage = 1; loadData(); } });
resetBtn.addEventListener("click", () => { searchInput.value = ""; currentPage = 1; loadData(); });

loadData();
