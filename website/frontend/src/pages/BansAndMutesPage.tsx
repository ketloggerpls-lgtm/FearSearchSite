import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, AlertTriangle, Clock, ShieldX, RefreshCw, Users, TrendingUp, Scissors, Ban } from 'lucide-react';
import { api } from '../services/api';
import type { Punishment } from '../types';

type Tab = 'all' | 'bans' | 'mutes';
type StatusFilter = 'all' | 'active' | 'removed' | 'expired';

function durStr(dur?: number): string {
  if (dur == null) return '—';
  if (dur <= 0) return '∞';
  if (dur >= 2592000) return `${Math.floor(dur / 2592000)}мес`;
  if (dur >= 86400) return `${Math.floor(dur / 86400)}д`;
  if (dur >= 3600) return `${Math.floor(dur / 3600)}ч`;
  if (dur >= 60) return `${Math.floor(dur / 60)}м`;
  return `${dur}с`;
}

function shortReason(s?: string): string {
  const r = (s || '—').replace(/\n/g, ' ').trim();
  return r.length > 45 ? r.slice(0, 45) + '…' : r;
}

interface ProfileInfo { name?: string; avatar?: string; }
type ProfileMap = Record<string, ProfileInfo>;

interface StaffSummary {
  steamid: string;
  name: string;
  bans: number;
  mutes: number;
  removed: number;
  total: number;
}

const statusOptions: { key: StatusFilter; label: string; color: string }[] = [
  { key: 'all', label: 'Все', color: 'text-gray-400 bg-white/5' },
  { key: 'active', label: 'Активны', color: 'text-red-400 bg-red-400/10' },
  { key: 'removed', label: 'Сняты', color: 'text-emerald-400 bg-emerald-400/10' },
  { key: 'expired', label: 'Истёкшие', color: 'text-gray-400 bg-gray-400/10' },
];

const statusMap: Record<number, { label: string; color: string }> = {
  1: { label: 'Активен', color: 'text-red-400 bg-red-400/10' },
  2: { label: 'Снят', color: 'text-emerald-400 bg-emerald-400/10' },
  4: { label: 'Истёк', color: 'text-gray-400 bg-gray-400/10' },
};

export default function BansAndMutesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [filterAdmin, setFilterAdmin] = useState('');
  const [loading, setLoading] = useState(false);
  const [punishments, setPunishments] = useState<Punishment[]>([]);
  const [total, setTotal] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [staffSearch, setStaffSearch] = useState('');
  const [staffSummary, setStaffSummary] = useState<StaffSummary | null>(null);
  const [staffSearching, setStaffSearching] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const statusParam = useMemo(() => {
    switch (statusFilter) {
      case 'active': return 1;
      case 'removed': return 2;
      case 'expired': return 4;
      default: return 0;
    }
  }, [statusFilter]);

  const typeParam = useMemo(() => {
    switch (activeTab) {
      case 'bans': return 1;
      case 'mutes': return 2;
      default: return 0;
    }
  }, [activeTab]);

  const fetchPunishments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getStaffPunishments({
        type: typeParam,
        status: statusParam,
        search: debouncedSearch,
        limit: 5000,
      });
      const items: Punishment[] = res.punishments || [];
      items.sort((a: any, b: any) => (b.created || 0) - (a.created || 0));
      setPunishments(items);
      setTotal(res.total || items.length);
      setLastRefresh(new Date());

      const idsToResolve = new Set<string>();
      for (const p of items) {
        if (p.steamid && !p.name && !profiles[p.steamid]) idsToResolve.add(p.steamid);
        if (p.admin_steamid && !p.admin_name && !profiles[p.admin_steamid]) idsToResolve.add(p.admin_steamid);
      }
      if (idsToResolve.size > 0) {
        try {
          const nameRes = await api.resolveNames([...idsToResolve]);
          if (nameRes?.profiles) {
            setProfiles(prev => ({ ...prev, ...nameRes.profiles }));
          }
        } catch {}
      }
    } catch {
      setPunishments([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [typeParam, statusParam, debouncedSearch]);

  useEffect(() => {
    fetchPunishments();
    const interval = setInterval(fetchPunishments, 120000);
    return () => clearInterval(interval);
  }, [fetchPunishments]);

  useEffect(() => { setPage(1); }, [activeTab, debouncedSearch, statusFilter, filterAdmin]);

  const [page, setPage] = useState(1);
  const pageSize = 50;

  const uniqueAdmins = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of punishments) {
      if (p.admin_steamid && !map.has(p.admin_steamid)) {
        const name = p.admin_name || profiles[p.admin_steamid]?.name || p.admin_steamid;
        map.set(p.admin_steamid, name);
      }
    }
    return map;
  }, [punishments, profiles]);

  const filteredPunishments = useMemo(() => {
    if (!filterAdmin) return punishments;
    return punishments.filter(p => p.admin_steamid === filterAdmin);
  }, [punishments, filterAdmin]);

  const pagedPunishments = useMemo(() => {
    return filteredPunishments.slice((page - 1) * pageSize, page * pageSize);
  }, [filteredPunishments, page]);
  const pageCount = Math.max(1, Math.ceil(filteredPunishments.length / pageSize));

  const handleStaffSearch = async () => {
    if (!staffSearch.trim()) {
      setStaffSummary(null);
      return;
    }
    setStaffSearching(true);
    try {
      const res = await api.getPunishmentsByAdminPG(staffSearch.trim(), 0, 5000);
      const items: Punishment[] = res.punishments || [];
      const bans = items.filter(p => p.type === 1);
      const mutes = items.filter(p => p.type === 2);
      const removed = items.filter(p => p.status === 2);
      const profileInfo = profiles[staffSearch.trim()];
      setStaffSummary({
        steamid: staffSearch.trim(),
        name: profileInfo?.name || staffSearch.trim(),
        bans: bans.length,
        mutes: mutes.length,
        removed: removed.length,
        total: items.length,
      });
    } catch {
      setStaffSummary(null);
    } finally {
      setStaffSearching(false);
    }
  };

  const getStatusLabel = (status: number) => {
    return statusMap[status] || { label: 'Неизвестно', color: 'text-gray-400 bg-gray-400/10' };
  };

  const getProfileName = (steamid: string, fallback?: string) => {
    if (!steamid) return undefined;
    const p = profiles[steamid];
    if (p?.name && p.name !== 'undefined') return p.name;
    if (fallback && fallback !== steamid && fallback !== 'undefined' && fallback !== '') return fallback;
    return undefined;
  };

  const getProfileAvatar = (steamid: string) => {
    return profiles[steamid]?.avatar || '';
  };

  return (
    <div className="max-w-[1100px] mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Наказания</h1>
          <p className="text-sm text-[#8a8a93] mt-1">
            {activeTab === 'all' ? 'Все наказания' : activeTab === 'bans' ? 'Баны' : 'Муты'} • Найдено: {filteredPunishments.length} • Обновлено: {lastRefresh.toLocaleTimeString('ru-RU')}
          </p>
        </div>
        <button onClick={() => { setLoading(true); fetchPunishments(); }}
          className="flex items-center gap-2 px-4 py-2 bg-[#141822] border border-white/5 rounded-lg text-sm text-gray-400 hover:text-white hover:border-blue-500/30 transition-all">
          <RefreshCw className="w-4 h-4" />Обновить
        </button>
      </motion.div>

      {/* Staff Search */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }}
        className="bg-[#12151e] rounded-xl border border-white/5 p-4 mb-4">
        <div className="flex gap-3 items-center">
          <Search className="w-4 h-4 text-gray-500 flex-shrink-0" />
          <input type="text" placeholder="Поиск по SteamID администратора (например: 76561198...)"
            value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleStaffSearch()}
            className="flex-1 px-4 py-2.5 bg-[#0c0e14] border border-white/5 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/30 transition-all" />
          <button onClick={handleStaffSearch} disabled={staffSearching}
            className="px-4 py-2.5 bg-[#4f7cff] hover:bg-[#3d6aff] text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50">
            {staffSearching ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Найти'}
          </button>
        </div>
      </motion.div>

      {/* Staff Summary Card */}
      {staffSummary && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="grid grid-cols-5 gap-4 mb-4">
          <div className="bg-[#12151e] rounded-xl p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-2"><ShieldX className="w-4 h-4 text-red-400" /><span className="text-xs text-gray-500">Баны</span></div>
            <p className="text-2xl font-bold text-white">{staffSummary.bans}</p>
          </div>
          <div className="bg-[#12151e] rounded-xl p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4 text-amber-400" /><span className="text-xs text-gray-500">Муты</span></div>
            <p className="text-2xl font-bold text-white">{staffSummary.mutes}</p>
          </div>
          <div className="bg-[#12151e] rounded-xl p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-blue-400" /><span className="text-xs text-gray-500">Всего</span></div>
            <p className="text-2xl font-bold text-white">{staffSummary.total}</p>
          </div>
          <div className="bg-[#12151e] rounded-xl p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-2"><Scissors className="w-4 h-4 text-emerald-400" /><span className="text-xs text-gray-500">Снято</span></div>
            <p className="text-2xl font-bold text-white">{staffSummary.removed}</p>
          </div>
          <div className="bg-[#12151e] rounded-xl p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-2"><Users className="w-4 h-4 text-purple-400" /><span className="text-xs text-gray-500">Сотрудник</span></div>
            <p className="text-lg font-bold text-white truncate">{staffSummary.name}</p>
            <p className="text-[11px] text-gray-500 font-mono truncate">{staffSummary.steamid}</p>
          </div>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="bg-[#12151e] rounded-xl border border-white/5 p-4 mb-6">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button onClick={() => setActiveTab('all')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'all' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-[#1a1f2e] text-gray-400 border border-white/5 hover:text-white'}`}>
            <Ban className="w-4 h-4" />Все
          </button>
          <button onClick={() => setActiveTab('bans')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'bans' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-[#1a1f2e] text-gray-400 border border-white/5 hover:text-white'}`}>
            <ShieldX className="w-4 h-4" />Баны
          </button>
          <button onClick={() => setActiveTab('mutes')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'mutes' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-[#1a1f2e] text-gray-400 border border-white/5 hover:text-white'}`}>
            <AlertTriangle className="w-4 h-4" />Муты
          </button>
          <div className="h-6 w-px bg-white/10 mx-1" />
          {statusOptions.map(s => (
            <button key={s.key} onClick={() => setStatusFilter(s.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${statusFilter === s.key ? s.color + ' border-current' : 'bg-[#1a1f2e] text-gray-400 border-white/5 hover:text-white'}`}>
              {s.label}
            </button>
          ))}
          {uniqueAdmins.size > 0 && (
            <select value={filterAdmin} onChange={e => setFilterAdmin(e.target.value)}
              className="px-3 py-2 bg-[#1a1f2e] border border-white/5 rounded-lg text-xs text-gray-400 focus:outline-none cursor-pointer">
              <option value="">Все админы</option>
              {[...uniqueAdmins.entries()].map(([sid, name]) => (
                <option key={sid} value={sid}>{name} ({sid})</option>
              ))}
            </select>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input type="text" placeholder="Поиск по нику / SteamID / админу / причине..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-[#0c0e14] border border-white/5 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/30 transition-all" />
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="bg-[#12151e] rounded-xl border border-white/5 overflow-hidden">
        <div className="grid grid-cols-[40px_1fr_1fr_1fr_120px_80px_80px_100px] gap-3 px-4 py-3 border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider font-semibold">
          <span>№</span><span>Игрок</span><span>SteamID</span><span>Причина</span><span>Админ</span><span>Статус</span><span>Длит.</span><span>Дата</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : pagedPunishments.length > 0 ? (
          <div className="divide-y divide-white/[0.03] max-h-[calc(100vh-420px)] overflow-y-auto">
            {pagedPunishments.map((p, i) => {
              const statusInfo = getStatusLabel(p.status);
              const playerName = p.name || getProfileName(p.steamid);
              const playerAvatar = getProfileAvatar(p.steamid);
              const adminName = p.admin_name || getProfileName(p.admin_steamid, p.admin);
              const adminAvatar = getProfileAvatar(p.admin_steamid);
              const rowNum = (page - 1) * pageSize + i + 1;
              const date = p.created
                ? new Date(p.created * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
                : p.time
                  ? new Date(p.time).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
                  : '—';
              return (
                <motion.div key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.02, 0.5) }}
                  className="grid grid-cols-[40px_1fr_1fr_1fr_120px_80px_80px_100px] gap-3 px-4 py-3 hover:bg-[#161a25] transition-colors items-center">
                  <span className="text-sm text-gray-600">{rowNum}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    {playerAvatar ? (
                      <img src={playerAvatar} alt="" className="w-7 h-7 rounded-lg object-cover ring-1 ring-white/10 flex-shrink-0" />
                    ) : (
                      <div className="w-7 h-7 bg-[#1e2333] rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-gray-500">{playerName?.charAt(0)?.toUpperCase() || '?'}</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{playerName || p.steamid || '—'}</p>
                      {playerName && p.steamid && (
                        <a href={`https://fearproject.ru/profile/${p.steamid}`} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-gray-500 hover:text-blue-400 font-mono truncate block">{p.steamid}</a>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 font-mono truncate">{p.steamid}</span>
                  <span className="text-sm text-gray-300 truncate" title={p.reason}>{shortReason(p.reason)}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    {adminAvatar ? (
                      <img src={adminAvatar} alt="" className="w-5 h-5 rounded object-cover ring-1 ring-white/10 flex-shrink-0" />
                    ) : null}
                    <div className="min-w-0">
                      <span className="text-xs text-gray-400 truncate block">{adminName || '—'}</span>
                      {adminName && adminName !== p.admin_steamid && p.admin_steamid && (
                        <span className="text-[10px] text-gray-600 font-mono truncate block">{p.admin_steamid}</span>
                      )}
                    </div>
                  </div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${statusInfo.color}`}>{statusInfo.label}</span>
                  <span className="text-xs text-gray-400"><Clock className="w-3 h-3 inline mr-1" />{durStr(p.duration)}</span>
                  <span className="text-xs text-gray-500">{date}</span>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12"><p className="text-gray-500">Наказания не найдены</p></div>
        )}

        {pageCount > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 text-xs text-gray-400">
            <span>Страница {page} из {pageCount}</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 bg-[#1a1f2e] border border-white/5 rounded-lg hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">Назад</button>
              <button disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 bg-[#1a1f2e] border border-white/5 rounded-lg hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">Вперёд</button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
