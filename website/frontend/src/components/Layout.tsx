import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Search, Shield, Settings, LogOut, AlertTriangle,
  ChevronRight, Menu, X, Crown, Ban, BarChart3, ShieldCheck, FileText, Home, UserCircle, HelpCircle, List
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';

const ghostLogo = '/ghost-logo.webp';

type NavItem = {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  minLevel: number;
  color: string;
  badge?: 'players' | 'staff';
};

const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: 'ОСНОВНОЕ',
    items: [
      { path: '/dashboard', label: 'Главная', icon: Home, minLevel: 1, color: 'indigo' },
      { path: '/players', label: 'Игроки', icon: Users, minLevel: 1, color: 'blue', badge: 'players' },
      { path: '/staff', label: 'Стафф', icon: Users, minLevel: 1, color: 'emerald', badge: 'staff' },
      { path: '/punishments', label: 'Наказания', icon: AlertTriangle, minLevel: 1, color: 'amber' },
      { path: '/checker', label: 'Проверка', icon: Search, minLevel: 1, color: 'cyan' },
    ],
  },
  {
    title: 'МОНИТОРИНГ',
    items: [
      { path: '/leaderboard', label: 'Топ-1000', icon: BarChart3, minLevel: 2, color: 'violet' },
      { path: '/bans-mutes', label: 'Баны и муты', icon: Ban, minLevel: 2, color: 'rose' },
      { path: '/staff-stats', label: 'Статистика', icon: BarChart3, minLevel: 2, color: 'purple' },
      { path: '/vdf-history', label: 'История VDF', icon: FileText, minLevel: 3, color: 'gray' },
      { path: '/logs', label: 'Логи', icon: List, minLevel: 3, color: 'slate' },
    ],
  },
  {
    title: 'УПРАВЛЕНИЕ',
    items: [
      { path: '/whitelist', label: 'Белый список', icon: ShieldCheck, minLevel: 4, color: 'green' },
      { path: '/evaders', label: 'Обходники', icon: AlertTriangle, minLevel: 4, color: 'orange' },
      { path: '/admin', label: 'Пользователи', icon: Crown, minLevel: 4, color: 'yellow' },
    ],
  },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout, hasLevel } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [onlinePlayers, setOnlinePlayers] = useState(0);
  const [onlineStaff, setOnlineStaff] = useState(0);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const serversRes = await api.getServers().catch(() => []);
        const servers = Array.isArray(serversRes) ? serversRes : (serversRes?.data || serversRes?.servers || []);
        let totalPlayers = 0;
        for (const s of servers) {
          totalPlayers += s.players_online || s.live_data?.players?.length || 0;
        }
        setOnlinePlayers(totalPlayers);
      } catch {
        setOnlinePlayers(0);
      }
      try {
        const summary = await api.getServerActivitySummary().catch(() => null);
        setOnlineStaff(summary?.current_admins || 0);
      } catch {
        setOnlineStaff(0);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, []);

  const getRoleLabel = (group: string) => {
    const labels: Record<string, string> = {
      OWNER: 'Владелец',
      OWNER_ALT: 'Владелец',
      CURATOR: 'Куратор',
      GLADMIN: 'Гл. Администратор',
      STADMIN: 'Ст. Администратор',
      MODER: 'Модератор',
      STMODER: 'Ст. Модератор',
      MLMODER: 'Мл. Модератор',
      DOSTUP: 'Доступ',
      ADMIN: 'Администратор',
      ADMIN_PLUS: 'Администратор+',
      CHECKER: 'Чекер',
    };
    return labels[group] || 'Staff';
  };

  const userAvatar = user?.avatar
    ? `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=64`
    : null;

  const displayName = user?.display_name || user?.username || 'User';
  const roleLabel = getRoleLabel(user?.staff_group || '');

  const getBadge = (item: NavItem) => {
    if (item.badge === 'players') return onlinePlayers;
    if (item.badge === 'staff') return onlineStaff;
    return null;
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white relative">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 grid-bg" />
        <div className="absolute -top-[200px] -left-[200px] w-[600px] h-[600px] bg-[#5865F2] rounded-full blur-[120px] opacity-[0.07]" />
        <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-indigo-500 rounded-full blur-[100px] opacity-[0.05]" />
      </div>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-[#0c0e14]/90 backdrop-blur-md border-b border-white/5 px-4 py-3 flex items-center justify-between">
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-gray-400 hover:text-white">
          {mobileMenuOpen ? <X className="w-7 h-7" /> : <Menu className="w-7 h-7" />}
        </button>
        <span className="text-base font-bold text-white">FearSearch Staff</span>
        <div className="w-7" />
      </div>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 bg-black/60 z-40"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Left Sidebar */}
      <aside
        className={`z-50 flex flex-col overflow-y-auto hide-scrollbar
          fixed top-0 left-0 h-full w-[260px] bg-[#0c0e14]/95 backdrop-blur-md border-r border-white/5 p-5
          lg:fixed lg:top-12 lg:left-12 lg:w-[260px] lg:max-h-[calc(100vh-6rem)] lg:h-auto lg:bg-transparent lg:backdrop-blur-none lg:border-0 lg:p-0
          transition-transform lg:translate-x-0
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="space-y-4">
          {/* Server Stats */}
          <section className="glass-panel p-3 pr-6 rounded-2xl flex items-center gap-4 relative">
            <div className="relative w-[52px] h-[52px] rounded-xl flex items-center justify-center shrink-0 overflow-hidden bg-[#5865F2]/10 border border-[#5865F2]/20">
              <img src={ghostLogo} alt="FearSearch" className="w-full h-full object-cover" />
            </div>
            <div className="flex flex-col gap-[2px] flex-1">
              <div className="flex items-center justify-between gap-4 text-[13px] leading-tight">
                <span className="text-[#9ca3af] font-medium tracking-wide">Игроков:</span>
                <span className="text-white font-bold tracking-wide tabular-nums text-[14px]">{onlinePlayers}</span>
              </div>
              <div className="flex items-center justify-between gap-4 text-[13px] leading-tight mt-0.5">
                <span className="text-[#9ca3af] font-medium tracking-wide">Админов:</span>
                <span className="text-white font-bold tracking-wide tabular-nums text-[14px]">{onlineStaff}</span>
              </div>
            </div>
            <div className="absolute top-2 right-2 flex items-center justify-center">
              <span className="status-dot" title="Онлайн"></span>
            </div>
          </section>

          {/* Navigation */}
          <nav className="glass-panel rounded-2xl overflow-hidden py-1 pointer-events-auto" aria-label="Навигация">
            {navSections.map((section) => {
              const visibleItems = section.items.filter((item) => hasLevel(item.minLevel));
              if (visibleItems.length === 0) return null;
              return (
                <div key={section.title}>
                  <div className="px-4 py-2 border-b border-white/[0.08]">
                    <h3 className="text-white font-bold text-xs uppercase tracking-wider">{section.title}</h3>
                  </div>
                  {visibleItems.map((item) => {
                    const isActive = location.pathname === item.path;
                    const badge = getBadge(item);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`dropdown-item px-4 py-3.5 flex items-center justify-between cursor-pointer ${isActive ? 'active' : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full bg-${item.color}-500/10 flex items-center justify-center shrink-0`}>
                            <Icon className={`text-${item.color}-400 text-xl`} />
                          </div>
                          <span className="text-[15px] font-semibold text-gray-100">{item.label}</span>
                        </div>
                        <div className="h-8 px-3.5 rounded-full bg-white/5 flex items-center justify-center border border-white/10 shrink-0">
                          {badge !== null ? (
                            <span className={`text-${item.color}-400 text-[14px] font-bold tabular-nums`}>{badge}</span>
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-400" />
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          {/* Mobile-only user / logout */}
          <div className="lg:hidden glass-panel rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-3">
              {userAvatar ? (
                <img
                  src={userAvatar}
                  alt={user?.username}
                  className="w-12 h-12 rounded-full ring-2 ring-[#5865F2]/30"
                />
              ) : (
                <div className="w-12 h-12 bg-[#1a1f2e] rounded-full flex items-center justify-center">
                  <UserCircle className="w-6 h-6 text-gray-500" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-base font-bold text-white truncate">{displayName}</p>
                <p className="text-xs text-gray-400 truncate">{roleLabel}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full bg-white/5 hover:bg-white/10 text-gray-300 font-semibold py-2 px-4 rounded-lg text-sm flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Выйти
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="relative z-10 flex-1 min-h-screen lg:ml-[300px] lg:mr-[320px] pt-14 lg:pt-12">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="p-4 lg:p-8"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Right Sidebar */}
      <aside className="hidden lg:block fixed top-12 right-12 z-50 w-[280px] max-h-[calc(100vh-6rem)] overflow-y-auto hide-scrollbar">
        {/* User Card */}
        <div className="glass-panel p-4 rounded-2xl mb-4">
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-full mb-3 overflow-hidden ring-2 ring-[#5865F2]/30">
              {userAvatar ? (
                <img src={userAvatar} alt={user?.username} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-[#1a1f2e] flex items-center justify-center">
                  <UserCircle className="w-8 h-8 text-gray-500" />
                </div>
              )}
            </div>
            <h3 className="text-white font-bold text-center text-lg mb-1">{displayName}</h3>
            <p className="text-gray-400 text-xs text-center mb-4">{roleLabel}</p>
            <button
              onClick={logout}
              className="w-full bg-white/5 hover:bg-white/10 text-gray-300 font-semibold py-2 px-4 rounded-lg text-sm flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Выйти
            </button>
          </div>
        </div>

        {/* Control Panel */}
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-white/[0.08]">
            <h3 className="text-white font-bold text-sm">Панель управления</h3>
          </div>
          <nav className="p-2">
            <Link
              to="/settings"
              className="block w-full px-4 py-3 text-left text-gray-300 hover:bg-white/[0.05] rounded-lg flex items-center gap-3 mb-1"
            >
              <Settings className="w-5 h-5" />
              <span className="text-sm font-medium">Настройки</span>
            </Link>
            {hasLevel(3) && (
              <Link
                to="/logs"
                className="block w-full px-4 py-3 text-left text-gray-300 hover:bg-white/[0.05] rounded-lg flex items-center gap-3 mb-1"
              >
                <List className="w-5 h-5" />
                <span className="text-sm font-medium">Логи действий</span>
              </Link>
            )}
            <Link
              to="/faq"
              className="block w-full px-4 py-3 text-left text-gray-400 hover:bg-white/[0.05] rounded-lg flex items-center gap-3 mb-1"
            >
              <HelpCircle className="w-5 h-5" />
              <span className="text-sm font-medium">FAQ</span>
            </Link>
            <Link
              to="/profile"
              className="block w-full px-4 py-3 text-left text-gray-300 hover:bg-white/[0.05] rounded-lg flex items-center gap-3"
            >
              <UserCircle className="w-5 h-5" />
              <span className="text-sm font-medium">Профиль</span>
            </Link>
            {hasLevel(4) && (
              <Link
                to="/admin"
                className="block w-full px-4 py-3 text-left text-gray-300 hover:bg-white/[0.05] rounded-lg flex items-center gap-3 mt-1"
              >
                <Crown className="w-5 h-5" />
                <span className="text-sm font-medium">Пользователи</span>
              </Link>
            )}
          </nav>
        </div>
      </aside>
    </div>
  );
}
