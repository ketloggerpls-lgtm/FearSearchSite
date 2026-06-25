import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Shield, Activity, BarChart3, Award, Zap, Globe,
  Package, Banknote, Sparkles, TrendingUp, Clock, Maximize2
} from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';
import type { StaffMember, DashboardStats, DropItem, DropsStats } from '../types';

const roleColors: Record<string, string> = {
  OWNER: 'from-red-500 to-red-600',
  GLADMIN: 'from-orange-500 to-orange-600',
  STADMIN: 'from-yellow-500 to-yellow-600',
  ADMIN: 'from-amber-500 to-amber-600',
  ADMIN_PLUS: 'from-amber-500 to-amber-600',
  STMODER: 'from-emerald-500 to-emerald-600',
  MODER: 'from-blue-500 to-blue-600',
  MLMODER: 'from-cyan-500 to-cyan-600',
  CURATOR: 'from-purple-500 to-purple-600',
};

const roleNames: Record<string, string> = {
  OWNER: 'Владелец',
  GLADMIN: 'Гл. Администратор',
  STADMIN: 'Ст. Администратор',
  ADMIN: 'Администратор',
  ADMIN_PLUS: 'Администратор+',
  STMODER: 'Ст. Модератор',
  MODER: 'Модератор',
  MLMODER: 'Мл. Модератор',
  CURATOR: 'Куратор',
};

const rarityGradients: Record<string, string> = {
  '#b0c3d9': 'from-gray-400 to-gray-500',
  '#5e98d9': 'from-blue-400 to-blue-500',
  '#4b69ff': 'from-indigo-400 to-indigo-500',
  '#8847ff': 'from-purple-400 to-purple-500',
  '#d32ce6': 'from-fuchsia-400 to-fuchsia-500',
  '#eb4b4b': 'from-red-400 to-red-500',
  '#ffd700': 'from-yellow-300 to-amber-400',
  '#ade55c': 'from-lime-400 to-green-500',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityData, setActivityData] = useState<any[]>([]);
  const [activitySummary, setActivitySummary] = useState<any>(null);
  const [drops, setDrops] = useState<DropItem[]>([]);
  const [dropsStats, setDropsStats] = useState<DropsStats[]>([]);
  const [dropsServerStats, setDropsServerStats] = useState<any[]>([]);
  const [dropsLoading, setDropsLoading] = useState(true);
  const [dropsPeriod, setDropsPeriod] = useState<'today' | 'yesterday' | '7days'>('today');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const loadDashboard = async () => {
    try {
      const [staffRes, statsRes, activityRes, summaryRes, dropsRes, dropsStatsRes, dropsServersRes] = await Promise.all([
        api.getStaff().catch(() => ({ data: [] })),
        api.getDashboardStats().catch(() => ({ data: { total_staff: 0, staff_by_role: {} } })),
        api.getServerActivity(24).catch(() => ({ data: [] })),
        api.getServerActivitySummary().catch(() => null),
        api.getDrops({ hours: 24, limit: 12 }).catch(() => ({ drops: [] })),
        api.getDropsStats({ period: dropsPeriod }).catch(() => ({ stats: [] })),
        api.getDropsServerStats({ hours: 24 }).catch(() => ({ servers: [] })),
      ]);
      setStaff(staffRes.data || []);
      setStats(statsRes.data);
      setActivityData(activityRes?.data || []);
      setActivitySummary(summaryRes);
      setDrops(dropsRes?.drops || []);
      setDropsStats(dropsStatsRes?.stats || []);
      setDropsServerStats(dropsServersRes?.servers || []);
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
      setDropsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 60000);
    return () => clearInterval(interval);
  }, [dropsPeriod]);

  const chartData = activityData.map((d: any) => ({
    time: new Date(d.timestamp * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    players: d.total_players,
    admins: d.total_admins,
  }));

  const statCards = [
    { label: 'Total Staff', value: stats?.total_staff || 0, icon: Users, color: 'from-accent-blue to-accent-purple' },
    { label: 'Groups Active', value: Object.keys(stats?.staff_by_role || {}).length, icon: BarChart3, color: 'from-cyan-500 to-cyan-600' },
    { label: 'Online Staff', value: activitySummary?.current_admins || 0, icon: Shield, color: 'from-emerald-500 to-emerald-600' },
    { label: 'Online Players', value: activitySummary?.current || 0, icon: Globe, color: 'from-blue-500 to-blue-600' },
  ];

  const onlineCards = [
    { label: 'Online Now', value: activitySummary?.current || 0, icon: Globe, color: 'from-green-500 to-green-600' },
    { label: 'Max (24h)', value: activitySummary?.max_24h || 0, icon: Maximize2, color: 'from-blue-500 to-blue-600' },
    { label: 'Avg (24h)', value: activitySummary?.avg_24h || 0, icon: Activity, color: 'from-purple-500 to-purple-600' },
    { label: 'Snapshots', value: activitySummary?.snapshots_24h || 0, icon: Clock, color: 'from-amber-500 to-amber-600' },
  ];

  const todayStats = dropsStats[0] || {
    total_drops: 0,
    total_value: 0,
    unique_players: 0,
    average_value: 0,
    most_expensive: 0,
  };

  const dropsChartData = useMemo(() => {
    return dropsStats.map((s) => ({
      date: s.date.slice(5),
      drops: s.total_drops,
      value: Math.round(s.total_value),
    })).reverse();
  }, [dropsStats]);

  const dropsCards = [
    { label: 'Всего дропов', value: todayStats.total_drops, icon: Package, color: 'from-blue-500 to-indigo-500' },
    { label: 'Общая стоимость', value: `₽${Math.round(todayStats.total_value).toLocaleString('ru-RU')}`, icon: Banknote, color: 'from-emerald-500 to-green-600' },
    { label: 'Уникальных игроков', value: todayStats.unique_players, icon: Users, color: 'from-purple-500 to-fuchsia-500' },
    { label: 'Средняя стоимость', value: `₽${Math.round(todayStats.average_value).toLocaleString('ru-RU')}`, icon: Sparkles, color: 'from-amber-500 to-orange-500' },
  ];

  const formatPrice = (n: number) => `₽${Math.round(n).toLocaleString('ru-RU')}`;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-12 h-12 border-4 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="text-3xl font-bold text-white mb-2">
          Welcome back, <span className="gradient-text">{user?.display_name || user?.username}</span>
        </h1>
        <p className="text-gray-400">
          {user?.staff_role && user.staff_role !== 'Пользователь' ? `${user.staff_role} - ${user.staff_group}` : 'Staff Panel Dashboard'}
        </p>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card, i) => (
          <motion.div key={card.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.1 }} whileHover={{ y: -4 }}
            className="glass-card p-6"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-400 mb-1">{card.label}</p>
                <p className="text-3xl font-bold text-white">{card.value}</p>
              </div>
              <div className={`w-12 h-12 bg-gradient-to-br ${card.color} rounded-xl flex items-center justify-center shadow-lg`}>
                <card.icon className="w-6 h-6 text-white" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Online Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {onlineCards.map((card, i) => (
          <motion.div key={card.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 + i * 0.1 }} whileHover={{ y: -4 }}
            className="glass-card p-5"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 bg-gradient-to-br ${card.color} rounded-xl flex items-center justify-center`}>
                <card.icon className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-gray-400">{card.label}</p>
                <p className="text-2xl font-bold text-white">{card.value}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Drops Stats */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }}
        className="glass-card p-6"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-accent-blue" />
            Дропы FearProject
          </h2>
          <div className="flex items-center gap-2 bg-[#0c0e14] rounded-xl p-1 border border-white/5">
            {(['today', 'yesterday', '7days'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setDropsPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  dropsPeriod === p
                    ? 'bg-[#1a1f2e] text-white'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {p === 'today' ? 'Сегодня' : p === 'yesterday' ? 'Вчера' : '7 дней'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {dropsCards.map((card, i) => (
            <motion.div key={card.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 + i * 0.05 }} whileHover={{ y: -2 }}
              className="bg-[#0c0e14] rounded-xl p-4 border border-white/5"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-8 h-8 bg-gradient-to-br ${card.color} rounded-lg flex items-center justify-center`}>
                  <card.icon className="w-4 h-4 text-white" />
                </div>
                <p className="text-xs text-gray-500">{card.label}</p>
              </div>
              <p className="text-xl font-bold text-white">
                {dropsLoading ? <span className="inline-block w-16 h-5 bg-[#1a1f2e] rounded animate-pulse" /> : card.value}
              </p>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent drops */}
          <div>
            <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent-blue" />
              Последние дропы
            </h3>
            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {dropsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 bg-[#0c0e14] rounded-xl border border-white/5 animate-pulse" />
                ))
              ) : drops.length === 0 ? (
                <div className="text-sm text-gray-500 bg-[#0c0e14] rounded-xl p-4 border border-white/5">
                  Нет данных о дропах за выбранный период. Бот ещё не записал дропы в базу.
                </div>
              ) : (
                drops.map((drop, i) => {
                  const rarity = rarityGradients[drop.rarity_color] || 'from-gray-500 to-gray-600';
                  return (
                    <motion.div key={drop.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: i * 0.03 }}
                      className="flex items-center gap-3 px-3 py-2.5 bg-[#0c0e14] rounded-xl border border-white/5 hover:border-white/10 transition-colors"
                    >
                      <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${rarity} flex items-center justify-center flex-shrink-0`}>
                        {drop.image ? (
                          <img src={drop.image} alt="" className="w-8 h-8 object-contain rounded" />
                        ) : (
                          <Package className="w-4 h-4 text-white" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{drop.name}</p>
                        <p className="text-xs text-gray-500">{drop.steamid}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-emerald-400">{formatPrice(drop.price)}</p>
                        <p className="text-[10px] text-gray-600">
                          {new Date(drop.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>

          {/* Drops chart */}
          <div>
            <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-accent-blue" />
              Динамика дропов
            </h3>
            <div className="bg-[#0c0e14] rounded-xl p-4 border border-white/5 h-[320px]">
              {dropsChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dropsChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2333" />
                    <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: '#1a1f2e', border: '1px solid #2d3548', borderRadius: 8, fontSize: 12 }}
                      formatter={(value: any, name: any) => {
                        if (name === 'value') return [`₽${Number(value).toLocaleString('ru-RU')}`, 'Сумма'];
                        return [value, 'Дропы'];
                      }}
                    />
                    <Bar dataKey="drops" radius={[4, 4, 0, 0]}>
                      {dropsChartData.map((_, i) => (
                        <Cell key={`cell-${i}`} fill={i === dropsChartData.length - 1 ? '#4f7cff' : '#1e2333'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-gray-500">
                  {dropsLoading ? 'Загрузка графика...' : 'Нет данных для графика'}
                </div>
              )}
            </div>
          </div>
        </div>

        {dropsServerStats.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4 text-accent-blue" />
              Топ серверов по дропам
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {dropsServerStats.map((srv, i) => (
                <motion.div key={srv.server_id || i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 + i * 0.05 }}
                  className="bg-[#0c0e14] rounded-xl p-3 border border-white/5 flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{srv.server_name || srv.server_id}</p>
                    <p className="text-xs text-gray-500">{srv.drops_count} дропов</p>
                  </div>
                  <p className="text-sm font-semibold text-emerald-400">{formatPrice(srv.total_value)}</p>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {todayStats.most_expensive > 0 && (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
            <TrendingUp className="w-4 h-4 text-amber-400" />
            Самый дорогой дроп за период: <span className="text-white font-semibold">{formatPrice(todayStats.most_expensive)}</span>
          </div>
        )}
      </motion.div>

      {/* Server Activity Chart */}
      {chartData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.35 }}
          className="glass-card p-6"
        >
          <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            <Activity className="w-5 h-5 text-accent-blue" />
            Активность серверов (24ч)
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorPlayers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f7cff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4f7cff" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorAdmins" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2333" />
              <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1a1f2e', border: '1px solid #2d3548', borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="players" stroke="#4f7cff" fillOpacity={1} fill="url(#colorPlayers)" strokeWidth={2} />
              <Area type="monotone" dataKey="admins" stroke="#f59e0b" fillOpacity={1} fill="url(#colorAdmins)" strokeWidth={1} strokeDasharray="5 5" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      {/* Last refresh */}
      <div className="text-xs text-gray-600 flex items-center gap-2">
        <Zap className="w-3 h-3" />
        <span>Обновлено: {lastRefresh.toLocaleTimeString('ru-RU')}</span>
      </div>
    </div>
  );
}
