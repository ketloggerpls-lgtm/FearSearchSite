import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Activity, Search, ChevronDown, AlertTriangle, Info, XCircle, Clock, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

interface LogEntry {
  id: number;
  service: string;
  level: string;
  message: string;
  data?: any;
  created_at: string;
}

interface LogStats {
  total: number;
  today: number;
  errors_7d: number;
  services: Record<string, number>;
}

const levelColors: Record<string, string> = {
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
  warning: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  debug: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const levelIcons: Record<string, typeof AlertTriangle> = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  debug: Activity,
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [service, setService] = useState('');
  const [level, setLevel] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [showLevelFilter, setShowLevelFilter] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const limit = 50;

  const serviceTabs = [
    { key: '', label: 'Все' },
    { key: 'site', label: 'Сайт' },
    { key: 'bot', label: 'Бот' },
    { key: 'auth', label: 'Авторизация' },
  ];

  const load = () => {
    api.getLogs({ service, level, search, limit, offset: page * limit })
      .then((res: any) => {
        setLogs(res.logs || []);
        setTotal(res.total || 0);
      })
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  };

  const loadStats = () => {
    api.getLogsStats()
      .then((data: any) => setStats(data))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    loadStats();
    const interval = setInterval(() => { load(); loadStats(); }, 15000);
    return () => clearInterval(interval);
  }, [service, level, search, page]);

  const formatTime = (iso: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  const services = stats?.services ? Object.keys(stats.services) : [];
  const levels = ['error', 'warning', 'info', 'debug'];

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Activity className="w-7 h-7 text-accent-blue" />
          Logs
        </h1>
        <p className="text-sm text-gray-500 mt-1">Service logs and activity history</p>
      </motion.div>

      {/* Stats */}
      {stats && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="grid grid-cols-3 gap-4"
        >
          <div className="glass-card p-4 text-center">
            <p className="text-sm text-gray-400">Total</p>
            <p className="text-2xl font-bold text-white">{stats.total.toLocaleString()}</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-sm text-gray-400">Today</p>
            <p className="text-2xl font-bold text-blue-400">{stats.today.toLocaleString()}</p>
          </div>
          <div className="glass-card p-4 text-center">
            <p className="text-sm text-gray-400">Errors (7d)</p>
            <p className="text-2xl font-bold text-red-400">{stats.errors_7d.toLocaleString()}</p>
          </div>
        </motion.div>
      )}

      {/* Service tabs + Filters */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="flex flex-col gap-3"
      >
        <div className="flex gap-2 flex-wrap">
          {serviceTabs.map((tab) => (
            <button key={tab.key} onClick={() => { setService(tab.key); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${service === tab.key ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/30' : 'bg-[#1a1f2e] text-gray-400 border-white/5 hover:text-white'}`}
            >
              {tab.label}
              {tab.key && stats?.services?.[tab.key] !== undefined && (
                <span className="ml-1.5 text-[10px] text-gray-500">{stats.services[tab.key]}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input type="text" placeholder="Поиск по сообщению..." value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="input-field pl-10 text-sm"
            />
          </div>
          <div className="relative">
          <button onClick={() => { setShowLevelFilter(!showLevelFilter); }}
            className="flex items-center gap-2 px-3 py-2 glass-card hover:border-accent-blue/30 transition-all text-sm"
          >
            <span className="text-gray-300">{level || 'All Levels'}</span>
            <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${showLevelFilter ? 'rotate-180' : ''}`} />
          </button>
          {showLevelFilter && (
            <div className="absolute right-0 top-full mt-1 w-36 glass-card p-1 z-20">
              <button onClick={() => { setLevel(''); setShowLevelFilter(false); setPage(0); }}
                className={`w-full text-left px-3 py-1.5 rounded text-sm ${!level ? 'bg-accent-blue/10 text-accent-blue' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
              >All Levels</button>
              {levels.map((l) => (
                <button key={l} onClick={() => { setLevel(l); setShowLevelFilter(false); setPage(0); }}
                  className={`w-full text-left px-3 py-1.5 rounded text-sm ${level === l ? 'bg-accent-blue/10 text-accent-blue' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                >{l}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => { load(); loadStats(); }}
          className="flex items-center gap-2 px-3 py-2 glass-card hover:border-accent-blue/30 transition-all text-sm"
        >
          <RefreshCw className="w-4 h-4 text-gray-400" />
        </button>
        </div>
      </motion.div>

      {/* Log Table */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Activity className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">No logs found</p>
        </div>
      ) : (
        <div className="space-y-1">
          {logs.map((log) => {
            const Icon = levelIcons[log.level] || Info;
            const expanded = expandedId === log.id;
            return (
              <motion.div key={log.id}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => setExpandedId(expanded ? null : log.id)}
                className="cursor-pointer px-4 py-2.5 bg-[#12151e] rounded-lg border border-white/5 hover:border-white/10 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xs text-gray-600 font-mono w-16 flex-shrink-0 pt-0.5">{log.id}</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase border flex-shrink-0 ${levelColors[log.level] || 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                    <Icon className="w-3 h-3" />
                    {log.level}
                  </span>
                  <span className="px-2 py-0.5 bg-white/5 rounded text-[10px] text-gray-400 font-mono flex-shrink-0">{log.service}</span>
                  <span className={`text-sm flex-1 min-w-0 ${expanded ? 'text-gray-300 whitespace-pre-wrap' : 'text-gray-300 truncate'}`}>{log.message}</span>
                  <span className="text-xs text-gray-600 flex-shrink-0 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTime(log.created_at)}
                  </span>
                </div>
                {expanded && log.data && (
                  <div className="mt-2 ml-[88px] p-2 bg-[#0c0e14] rounded border border-white/5 text-xs text-gray-400 font-mono whitespace-pre-wrap overflow-x-auto">
                    {JSON.stringify(log.data, null, 2)}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">
            Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              className="px-3 py-1.5 glass-card text-sm text-gray-300 disabled:opacity-30 hover:border-accent-blue/30 transition-all"
            >Prev</button>
            <button onClick={() => setPage(page + 1)} disabled={(page + 1) * limit >= total}
              className="px-3 py-1.5 glass-card text-sm text-gray-300 disabled:opacity-30 hover:border-accent-blue/30 transition-all"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
