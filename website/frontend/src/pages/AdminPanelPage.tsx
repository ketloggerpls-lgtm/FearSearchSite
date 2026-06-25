import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Crown, Users, Search, Lock, Monitor, X, Globe, MapPin, Smartphone } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import type { AdminUser } from '../types';

const OWNER_DISCORD_ID = '1500235583367417866';

const DEFAULT_LEVEL_OPTIONS = [
  { value: -1, label: 'Заблокирован', color: 'text-red-400' },
  { value: 1, label: 'LVL 1 — Администратор', color: 'text-emerald-400' },
  { value: 2, label: 'LVL 2 — Модератор', color: 'text-purple-400' },
  { value: 3, label: 'LVL 3 — Ст. Модератор', color: 'text-blue-400' },
  { value: 4, label: 'LVL 4 — Администратор', color: 'text-orange-400' },
  { value: 5, label: 'LVL 5 — Владелец', color: 'text-yellow-400' },
];

interface RoleItem {
  key: string;
  name: string;
  level: number;
  role_id?: string;
}

function buildLevelOptions(roles: RoleItem[]) {
  if (!roles || roles.length === 0) return DEFAULT_LEVEL_OPTIONS;
  const grouped = new Map<number, string[]>();
  for (const r of roles) {
    if (r.level < 1) continue;
    if (!grouped.has(r.level)) grouped.set(r.level, []);
    grouped.get(r.level)!.push(r.name);
  }
  const options = [{ value: -1, label: 'Заблокирован', color: 'text-red-400' }];
  for (let lvl = 1; lvl <= 5; lvl++) {
    const names = grouped.get(lvl) || [];
    const defaultLabel = DEFAULT_LEVEL_OPTIONS.find(o => o.value === lvl)?.label || `LVL ${lvl}`;
    const label = names.length > 0 ? `LVL ${lvl} — ${names.join(' / ')}` : defaultLabel;
    const color = DEFAULT_LEVEL_OPTIONS.find(o => o.value === lvl)?.color || 'text-gray-400';
    options.push({ value: lvl, label, color });
  }
  return options;
}

const GROUP_MAP: Record<number, string> = {
  '-1': 'UNDEFINED',
  '1': 'ADMIN',
  '2': 'MODER',
  '3': 'STMODER',
  '4': 'STADMIN',
  '5': 'OWNER',
};

function getLevelColor(level: number) {
  if (level >= 5) return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
  if (level >= 4) return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
  if (level >= 3) return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
  if (level >= 2) return 'text-purple-400 bg-purple-400/10 border-purple-400/20';
  if (level >= 1) return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
  return 'text-red-400 bg-red-400/10 border-red-400/20';
}

export default function AdminPanelPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [callerInfo, setCallerInfo] = useState<{ is_owner: boolean; caller_level: number }>({ is_owner: false, caller_level: 0 });
  const [sessionsUser, setSessionsUser] = useState<AdminUser | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const LEVEL_OPTIONS = useMemo(() => buildLevelOptions(roles), [roles]);

  const fetchUsers = async () => {
    try {
      const res = await api.getAdminUsers();
      setUsers(res.data || []);
      setCallerInfo({ is_owner: res.is_owner || false, caller_level: res.caller_level || 0 });
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    api.getRoles()
      .then((res: any) => setRoles(res.roles || res.data || []))
      .catch(() => setRoles([]));
  }, []);

  const handleLevelChange = async (discordId: string, newLevel: number) => {
    if (discordId === OWNER_DISCORD_ID) return;
    setUpdating(discordId);
    try {
      const group = GROUP_MAP[newLevel] || 'UNDEFINED';
      await api.updateUserLevel(discordId, newLevel, group);
      setUsers(prev => prev.map(u =>
        u.discord_id === discordId
          ? { ...u, level: newLevel, is_blocked: newLevel < 0, staff_group: group }
          : u
      ));
    } catch (err) {
      console.error('Failed to update user:', err);
    } finally {
      setUpdating(null);
    }
  };

  const handleBlock = async (discordId: string) => {
    if (discordId === OWNER_DISCORD_ID) return;
    if (!confirm('Заблокировать пользователя?')) return;
    setUpdating(discordId);
    try {
      await api.blockUser(discordId);
      setUsers(prev => prev.map(u =>
        u.discord_id === discordId
          ? { ...u, level: -1, is_blocked: true, staff_group: 'UNDEFINED' }
          : u
      ));
    } catch (err) {
      console.error('Failed to block user:', err);
    } finally {
      setUpdating(null);
    }
  };

  const openSessions = async (target: AdminUser) => {
    setSessionsUser(target);
    setSessionsLoading(true);
    setSessions([]);
    try {
      const res = await api.getUserSessions(target.discord_id, 50);
      setSessions(res.sessions || []);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setSessionsLoading(false);
    }
  };

  const closeSessions = () => {
    setSessionsUser(null);
    setSessions([]);
  };

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.display_name?.toLowerCase().includes(q) ||
      u.username?.toLowerCase().includes(q) ||
      u.discord_id?.includes(q)
    );
  });

  const isProtected = (discordId: string, level: number) => {
    if (discordId === OWNER_DISCORD_ID) return true;
    if (level >= 5 && !callerInfo.is_owner) return true;
    return false;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <div className="flex items-center gap-3 mb-1">
          <Crown className="w-8 h-8 text-yellow-400" />
          <h1 className="text-3xl font-bold text-white">Пользователи</h1>
        </div>
        <p className="text-base text-[#8a8a93]">
          Управление уровнями доступа и сессиями
        </p>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-4 gap-4 mb-6"
      >
        <div className="bg-[#12151e] rounded-xl border border-white/5 p-5">
          <p className="text-sm text-gray-500 mb-1">Всего</p>
          <p className="text-3xl font-bold text-white">{users.length}</p>
        </div>
        <div className="bg-[#12151e] rounded-xl border border-white/5 p-5">
          <p className="text-sm text-gray-500 mb-1">Активных</p>
          <p className="text-3xl font-bold text-emerald-400">{users.filter(u => u.level >= 1).length}</p>
        </div>
        <div className="bg-[#12151e] rounded-xl border border-white/5 p-5">
          <p className="text-sm text-gray-500 mb-1">Заблокировано</p>
          <p className="text-3xl font-bold text-red-400">{users.filter(u => u.level < 0).length}</p>
        </div>
        <div className="bg-[#12151e] rounded-xl border border-white/5 p-5">
          <p className="text-sm text-gray-500 mb-1">LVL 5</p>
          <p className="text-3xl font-bold text-yellow-400">{users.filter(u => u.level >= 5).length}</p>
        </div>
      </motion.div>

      {/* Search */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mb-5"
      >
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input
            type="text"
            placeholder="Поиск по имени / Discord ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-4 bg-[#12151e] border border-white/5 rounded-xl text-base text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/30 transition-all"
          />
        </div>
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-[#12151e] rounded-xl border border-white/5 overflow-hidden"
      >
        <div className="grid grid-cols-[64px_1.2fr_1fr_1fr_120px_100px_140px] gap-4 px-5 py-4 border-b border-white/5 text-sm text-gray-500 uppercase tracking-wider font-semibold">
          <span>Аватар</span>
          <span>Пользователь</span>
          <span>Discord ID</span>
          <span>SteamID</span>
          <span>Сессии</span>
          <span>Уровень</span>
          <span className="text-right">Действия</span>
        </div>

        <div className="divide-y divide-white/[0.03] max-h-[calc(100vh-420px)] overflow-y-auto">
          {filtered.map((user) => {
            const protected_ = isProtected(user.discord_id, user.level);
            return (
              <div
                key={user.discord_id}
                className="grid grid-cols-[64px_1.2fr_1fr_1fr_120px_100px_140px] gap-4 px-5 py-4 hover:bg-[#161a25] transition-colors items-center"
              >
                {/* Avatar */}
                <div>
                  {user.avatar ? (
                    <img
                      src={`https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=64`}
                      alt={user.username}
                      className="w-11 h-11 rounded-full ring-1 ring-white/10"
                    />
                  ) : (
                    <div className="w-11 h-11 bg-[#1e2333] rounded-full flex items-center justify-center">
                      <Users className="w-5 h-5 text-gray-500" />
                    </div>
                  )}
                </div>

                {/* Name */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-base font-medium text-white truncate">{user.display_name || user.username}</p>
                    {user.is_online && (
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" title="Онлайн на сайте" />
                    )}
                    {user.discord_id === OWNER_DISCORD_ID && (
                      <Crown className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">{user.staff_role || 'Без роли'}</p>
                </div>

                {/* Discord ID */}
                <span className="text-sm text-gray-400 font-mono truncate">{user.discord_id}</span>

                {/* SteamID */}
                <div className="min-w-0">
                  {user.steam_id ? (
                    <a
                      href={`https://fearproject.ru/profile/${user.steam_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-gray-400 hover:text-blue-400 font-mono truncate block"
                    >
                      {user.steam_id}
                    </a>
                  ) : (
                    <span className="text-sm text-gray-600">—</span>
                  )}
                </div>

                {/* Sessions */}
                <div className="flex items-center justify-center">
                  <button
                    onClick={() => openSessions(user)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1f2e] hover:bg-[#1e2333] border border-white/5 rounded-lg text-xs text-gray-400 hover:text-white transition-all"
                    title="Активные сессии"
                  >
                    <Monitor className="w-3.5 h-3.5" />
                    <span>—</span>
                  </button>
                </div>

                {/* Level */}
                <div className="flex items-center gap-2">
                  {protected_ ? (
                    <div className="flex items-center gap-1.5">
                      <span className={`px-3 py-1.5 bg-[#1a1f2e] border border-white/5 rounded-lg text-xs font-medium ${getLevelColor(user.level)}`}>
                        LVL {user.level}
                      </span>
                      <Lock className="w-3 h-3 text-gray-600" />
                    </div>
                  ) : (
                    <select
                      value={user.level}
                      onChange={(e) => handleLevelChange(user.discord_id, parseInt(e.target.value))}
                      disabled={updating === user.discord_id}
                      className={`px-3 py-1.5 bg-[#1a1f2e] border border-white/5 rounded-lg text-xs font-medium focus:outline-none cursor-pointer ${getLevelColor(user.level)} disabled:opacity-50`}
                    >
                      {LEVEL_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Status */}
                <div className="flex items-center justify-end gap-2">
                  {user.level >= 1 ? (
                    <span className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-xs text-emerald-400 font-medium">
                      Активен
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400 font-medium">
                      Заблокирован
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-base">Пользователи не найдены</p>
          </div>
        )}
      </motion.div>

      {/* Sessions Modal */}
      <AnimatePresence>
        {sessionsUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={closeSessions}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#12151e] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between p-5 border-b border-white/5">
                <div className="flex items-center gap-3">
                  {sessionsUser.avatar ? (
                    <img
                      src={`https://cdn.discordapp.com/avatars/${sessionsUser.discord_id}/${sessionsUser.avatar}.png?size=64`}
                      alt={sessionsUser.username}
                      className="w-11 h-11 rounded-full ring-1 ring-white/10"
                    />
                  ) : (
                    <div className="w-11 h-11 bg-[#1e2333] rounded-full flex items-center justify-center">
                      <Users className="w-5 h-5 text-gray-500" />
                    </div>
                  )}
                  <div>
                    <p className="text-base font-bold text-white">
                      {sessionsUser.display_name || sessionsUser.username}
                    </p>
                    <p className="text-xs text-gray-500">
                      Сессии пользователя • Discord ID: {sessionsUser.discord_id}
                    </p>
                  </div>
                </div>
                <button
                  onClick={closeSessions}
                  className="p-2 hover:bg-[#1e2333] rounded-lg text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 overflow-y-auto flex-1">
                {sessionsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500 text-base">Нет данных о сессиях</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sessions.map((session, idx) => (
                      <div
                        key={idx}
                        className="bg-[#0c0e14] border border-white/5 rounded-xl p-4 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2 min-w-0">
                            <Monitor className="w-4 h-4 text-blue-400 flex-shrink-0" />
                            <span className="text-sm font-medium text-white truncate">
                              {session.browser || session.os || 'Неизвестное устройство'}
                            </span>
                            {session.os && (
                              <span className="text-xs text-gray-500">({session.os})</span>
                            )}
                          </div>
                          <span className="text-xs text-gray-500 whitespace-nowrap">
                            {session.logged_in_at ? new Date(session.logged_in_at).toLocaleString('ru-RU') : '—'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-3 text-sm text-gray-400">
                          <span className="flex items-center gap-1.5">
                            <Smartphone className="w-3.5 h-3.5 text-gray-500" />
                            IP: <span className="font-mono text-gray-300">{session.ip_address || '—'}</span>
                          </span>
                          {(session.country || session.city) && (
                            <span className="flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-gray-500" />
                              {[session.city, session.country].filter(Boolean).join(', ')}
                            </span>
                          )}
                          {session.steam_id && (
                            <span className="flex items-center gap-1.5">
                              <Globe className="w-3.5 h-3.5 text-gray-500" />
                              SteamID: <span className="font-mono text-gray-300">{session.steam_id}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-5 border-t border-white/5 flex justify-between items-center">
                <p className="text-sm text-gray-500">
                  Всего записей: {sessions.length}
                </p>
                <button
                  onClick={closeSessions}
                  className="px-5 py-2 bg-[#1e2333] hover:bg-[#2a3144] border border-white/5 rounded-lg text-sm text-white transition-colors"
                >
                  Закрыть
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
