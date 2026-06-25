import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, ChevronDown, ChevronUp, RefreshCw, Users, Wifi, WifiOff
} from 'lucide-react';
import { api } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import type { FearAPIServer, FearAPIPlayer } from '../types';
import PlayerCardModal from './PlayerCardModal';

type SortKey = 'name' | 'kd' | 'kills' | 'account_date' | 'flags';
type SortDir = 'asc' | 'desc';

interface PlayerRow extends FearAPIPlayer {
  status: 'clean' | 'banned' | 'online';
  avatar_url?: string;
  account_created?: number;
  flags?: string[];
  staffRole?: string;
  staffGroup?: string;
  faceit_level?: number;
  faceit_elo?: number;
  report_count?: number;
  reports_24h?: number;
}

function getWsUrl(): string {
  const explicit = import.meta.env.VITE_WS_URL;
  if (explicit) return explicit;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = import.meta.env.VITE_API_URL || window.location.host;
  return `${proto}//${host}/ws`;
}

const BATCH_SIZE = 90; // Steam API limit is ~100, stay safe

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('kills');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerRow | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [source, setSource] = useState<'ws' | 'api'>('api');
  const wsRef = useRef<Record<string, any>>({});
  const staffMapRef = useRef<Map<string, { role: string; group: string }>>(new Map());

  const { connected, lastMessage } = useWebSocket(getWsUrl());

  // Process WS messages — update only live player list without heavy enrichment
  useEffect(() => {
    if (!lastMessage || lastMessage.type !== 'all_players') return;
    wsRef.current = lastMessage.players || {};
    setSource('ws');
    setLastRefresh(new Date());

    const wsPlayers: PlayerRow[] = [];
    Object.entries(wsRef.current).forEach(([sid, p]: [string, any]) => {
      const staffInfo = staffMapRef.current.get(sid);
      wsPlayers.push({
        steam_id: sid,
        name: p.name || '',
        nickname: p.nickname || '',
        avatar: p.avatar || '',
        kills: p.kills || 0,
        deaths: p.deaths || 0,
        kd: p.kd || (p.deaths > 0 ? p.kills / p.deaths : p.kills || 0),
        server: p.server || '',
        server_id: p.server_id,
        flag: p.flag || '',
        status: 'online',
        staffRole: staffInfo?.role,
        staffGroup: staffInfo?.group,
      });
    });
    setPlayers(prev => {
      // Keep existing enriched data where possible
      const existing = new Map(prev.map(p => [p.steam_id, p]));
      return wsPlayers.map(p => {
        const old = existing.get(p.steam_id);
        return old ? { ...old, ...p } : p;
      });
    });
  }, [lastMessage]);

  const enrichFromSteam = useCallback(async (steamIds: string[]) => {
    if (steamIds.length === 0) return;
    const ids = steamIds.filter(Boolean);
    const chunks = chunk(ids, BATCH_SIZE);

    const summaryMap = new Map<string, { avatar: string; timecreated: number; name: string }>();
    const bansMap = new Map<string, { vac: boolean; gameBans: number; daysSinceLastBan: number }>();

    await Promise.all(chunks.map(async (c) => {
      try {
        const [summaryRes, bansRes] = await Promise.allSettled([
          api.getSteamSummaries(c),
          api.getSteamBansList(c),
        ]);
        if (summaryRes.status === 'fulfilled') {
          const players = summaryRes.value?.response?.players || [];
          players.forEach((p: any) => {
            summaryMap.set(p.steamid, {
              avatar: p.avatarfull || p.avatarmedium || '',
              timecreated: p.timecreated || 0,
              name: p.personaname || '',
            });
          });
        }
        if (bansRes.status === 'fulfilled') {
          const players = bansRes.value?.players || [];
          players.forEach((p: any) => {
            bansMap.set(p.SteamId, {
              vac: p.VACBanned,
              gameBans: p.NumberOfGameBans || 0,
              daysSinceLastBan: p.DaysSinceLastBan || 0,
            });
          });
        }
      } catch {
        // ignore chunk errors
      }
    }));

    setPlayers(prev => prev.map(p => {
      const summary = summaryMap.get(p.steam_id);
      const bans = bansMap.get(p.steam_id);
      const flags: string[] = [];
      if (bans?.vac) flags.push('VAC');
      if ((bans?.gameBans ?? 0) > 0) flags.push(`GAME BAN (×${bans?.gameBans})`);
      if (summary?.timecreated) {
        const ageDays = Math.floor((Date.now() / 1000 - summary.timecreated) / 86400);
        if (ageDays < 365) flags.push(`NEW (${ageDays}д)`);
      }
      return {
        ...p,
        account_created: summary?.timecreated || p.account_created,
        avatar: summary?.avatar || p.avatar || '',
        name: p.name || summary?.name || '',
        flags: flags.length > 0 ? flags : p.flags,
      };
    }));
  }, []);

  const enrichFromDB = useCallback(async (steamIds: string[]) => {
    if (steamIds.length === 0) return;
    const ids = steamIds.filter(Boolean);
    const chunks = chunk(ids, 200);
    const allData: Record<string, any> = {};
    await Promise.all(chunks.map(async (c) => {
      try {
        const res = await api.getPlayersEnrich(c);
        if (res?.data) Object.assign(allData, res.data);
      } catch {}
    }));
    setPlayers(prev => prev.map(p => {
      const d = allData[p.steam_id];
      if (!d) return p;
      return {
        ...p,
        faceit_level: d.faceit_level ?? p.faceit_level,
        faceit_elo: d.faceit_elo ?? p.faceit_elo,
        report_count: d.report_count ?? d.reports_24h ?? p.report_count,
        reports_24h: d.reports_24h ?? p.reports_24h,
      };
    }));
  }, []);

  const fetchPlayers = useCallback(async () => {
    try {
      const res = await api.getServers();
      const servers: FearAPIServer[] = Array.isArray(res) ? res : (res.data || res.servers || []);
      const allPlayers: PlayerRow[] = [];

      for (const server of servers) {
        const serverPlayers = server.live_data?.players || [];
        for (const p of serverPlayers) {
          allPlayers.push({
            ...p,
            server: server.name || `Server #${server.id}`,
            server_id: server.id,
            flag: server.flag || '',
            status: 'online' as const,
            kd: p.kd || (p.deaths > 0 ? p.kills / p.deaths : p.kills || 0),
          });
        }
      }

      // Load staff once and cache in ref
      try {
        const staffRes = await api.getStaff();
        const staffList = (staffRes?.data || (Array.isArray(staffRes) ? staffRes : [])) as any[];
        const staffMap = new Map<string, { role: string; group: string }>();
        for (const s of staffList) {
          const sid = s.steam_id || s.steamid;
          if (sid) staffMap.set(sid, { role: s.role || s.staff_role || '', group: s.group_name || s.staff_group || '' });
        }
        staffMapRef.current = staffMap;
        for (const p of allPlayers) {
          const staffInfo = staffMap.get(p.steam_id);
          if (staffInfo) {
            p.staffRole = staffInfo.role;
            p.staffGroup = staffInfo.group;
          }
        }
      } catch {}

      setPlayers(allPlayers);
      setLastRefresh(new Date());
      setSource('api');

      const steamIds = allPlayers.map(p => p.steam_id).filter(Boolean);
      if (steamIds.length > 0) {
        try {
          await enrichFromSteam(steamIds);
        } catch {}
        try {
          await enrichFromDB(steamIds);
        } catch {}
      }
    } catch {
      setPlayers([]);
    } finally {
      setLoading(false);
    }
  }, [enrichFromSteam, enrichFromDB]);

  useEffect(() => {
    fetchPlayers();
    // Only poll API if WS is not connected
    if (!connected) {
      const interval = setInterval(fetchPlayers, 30000);
      return () => clearInterval(interval);
    }
  }, [fetchPlayers, connected]);

  const filtered = useMemo(() => {
    let result = players;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.steam_id?.includes(q) ||
        p.nickname?.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = (a.name || '').localeCompare(b.name || '');
      else if (sortKey === 'kd') cmp = (a.kd || 0) - (b.kd || 0);
      else if (sortKey === 'kills') cmp = (a.kills || 0) - (b.kills || 0);
      else if (sortKey === 'account_date') cmp = (a.account_created || 0) - (b.account_created || 0);
      else if (sortKey === 'flags') cmp = (a.flags?.length || 0) - (b.flags?.length || 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [players, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'account_date' ? 'asc' : 'desc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const formatDate = (ts?: number) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-bold text-white">Игроки</h1>
          <p className="text-sm text-gray-500 mt-1">
            Найдено: {filtered.length} • Обновлено: {lastRefresh.toLocaleTimeString('ru-RU')}
            <span className="ml-2 inline-flex items-center gap-1">
              {connected ? (
                <><Wifi className="w-3 h-3 text-green-400" /> <span className="text-green-400">Live</span></>
              ) : (
                <><WifiOff className="w-3 h-3 text-yellow-400" /> <span className="text-yellow-400">API</span></>
              )}
            </span>
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchPlayers(); }}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-[#141822] border border-white/5 rounded-lg text-sm text-gray-400 hover:text-white hover:border-blue-500/30 transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          Обновить
        </button>
      </motion.div>

      {/* Sort Tabs + Search */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4"
      >
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'kills' as SortKey, label: 'По килам' },
            { key: 'kd' as SortKey, label: 'По K/D' },
            { key: 'flags' as SortKey, label: 'По флагам' },
            { key: 'account_date' as SortKey, label: 'По дате акка' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => toggleSort(f.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                sortKey === f.key
                  ? 'bg-[#4f7cff] text-white'
                  : 'bg-[#141822] text-gray-400 border border-white/5 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative sm:ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Поиск по нику / SteamID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-[280px] pl-9 pr-4 py-2.5 bg-[#141822] border border-white/5 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/30 transition-all"
          />
        </div>
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-[#12151e] rounded-xl border border-white/5 overflow-hidden"
      >
        <div className="hidden sm:grid grid-cols-[40px_1fr_70px_70px_90px_100px_120px] gap-4 px-5 py-3 border-b border-white/5 text-xs text-gray-500 uppercase tracking-wider font-semibold">
          <span>№</span>
          <button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-white transition-colors text-left">
            Игрок <SortIcon col="name" />
          </button>
          <button onClick={() => toggleSort('kd')} className="flex items-center gap-1 hover:text-white transition-colors text-left">
            K/D <SortIcon col="kd" />
          </button>
          <button onClick={() => toggleSort('kills')} className="flex items-center gap-1 hover:text-white transition-colors text-left">
            Kills <SortIcon col="kills" />
          </button>
          <span className="text-left">Faceit</span>
          <span className="text-left">Репорты</span>
          <span className="text-right">Действия</span>
        </div>

        <div className="divide-y divide-white/[0.03] max-h-[calc(100vh-300px)] overflow-y-auto">
          {filtered.map((player, i) => (
            <motion.div
              key={`${player.steam_id}-${player.server_id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i * 0.02, 0.5) }}
              className="grid grid-cols-1 sm:grid-cols-[40px_1fr_70px_70px_90px_100px_120px] gap-2 sm:gap-4 px-5 py-3 hover:bg-[#161a25] transition-colors items-center group"
            >
              <span className="hidden sm:block text-sm text-gray-600">{i + 1}</span>

              <div className="flex items-center gap-3 min-w-0">
                {player.avatar ? (
                  <img src={player.avatar} alt={player.name} className="w-9 h-9 rounded-lg object-cover ring-1 ring-white/10 hover:ring-blue-500/30 transition-all" />
                ) : (
                  <div className="w-9 h-9 bg-[#1e2333] rounded-lg flex items-center justify-center ring-1 ring-white/10">
                    <span className="text-sm font-bold text-gray-500">{player.name?.charAt(0)?.toUpperCase() || '?'}</span>
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{player.name || player.nickname || 'Unknown'}</p>
                    {player.staffRole && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 whitespace-nowrap">
                        {player.staffRole}
                      </span>
                    )}
                    {player.flags && player.flags.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {player.flags.map((f, fi) => (
                          <span key={fi} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            f.includes('VAC') || f.includes('BAN') ? 'bg-red-500/20 text-red-400' :
                            f.includes('YOOMA') ? 'bg-orange-500/20 text-orange-400' :
                            'bg-amber-500/20 text-amber-400'
                          }`}>
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 font-mono truncate">{player.steam_id}</p>
                </div>
              </div>

              <span className="text-sm text-gray-300">{(player.kd || 0).toFixed(2)}</span>
              <span className="text-sm text-white font-medium">{(player.kills || 0).toLocaleString()}</span>

              <div className="flex items-center gap-2">
                {player.faceit_level ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded">
                    L{player.faceit_level}
                    {player.faceit_elo ? <span className="text-[10px] text-gray-500">({player.faceit_elo})</span> : null}
                  </span>
                ) : (
                  <span className="text-xs text-gray-600">—</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {(player.reports_24h || player.report_count || 0) > 0 ? (
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${(player.reports_24h || 0) >= 3 ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                    {(player.reports_24h || player.report_count)}
                    <span className="text-[10px] text-gray-500">24ч</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-600">0</span>
                )}
              </div>

              <div className="flex items-center justify-start sm:justify-end gap-2">
                <button
                  onClick={() => setSelectedPlayer(player)}
                  className="px-3 py-1.5 bg-[#4f7cff] hover:bg-[#3d6aff] text-white rounded-lg text-xs font-medium transition-all"
                >
                  Карточка
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <Users className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className="text-gray-500">Игроки не найдены</p>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {selectedPlayer && (
          <PlayerCardModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
