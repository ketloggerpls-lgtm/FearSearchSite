const API_BASE = import.meta.env.VITE_API_URL || 'https://gggggggggggfffffffffffffffff-production.up.railway.app';

class ApiService {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async request(path: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      this.token = null;
      localStorage.removeItem('token');
      window.location.href = '/';
      throw new Error('Unauthorized');
    }

    if (res.status === 403) {
      const text = await res.json().catch(() => ({}));
      throw new Error(text.message || 'Доступ запрещён');
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API Error ${res.status}: ${text}`);
    }

    return res.json();
  }

  async getLoginUrl() {
    const res = await this.request('/api/auth/login');
    return res.url as string;
  }

  async getMe() {
    return this.request('/api/auth/me');
  }

  async getPublicProfile(id: string) {
    return this.request(`/api/user/profile/${id}`);
  }

  async getStaff() {
    return this.request('/api/staff');
  }

  async getStaffByGroup(group: string) {
    return this.request(`/api/staff/group?group=${group}`);
  }

  async getRoles() {
    return this.request('/api/roles');
  }

  async getDashboardStats() {
    return this.request('/api/dashboard/stats');
  }

  async getServers() {
    return this.request('/api/servers');
  }

  async getPlayersEnrich(steamids: string[]) {
    return this.request(`/api/players/enrich?steamids=${steamids.join(',')}`);
  }

  async getLeaderboard() {
    return this.request('/api/leaderboard');
  }

  async getProfile(steamId: string) {
    return this.request(`/api/profile/${steamId}`);
  }

  async getSkinchanger(steamId: string) {
    return this.request(`/api/skinchanger/${steamId}`);
  }

  async getPunishments(params?: { page?: number; limit?: number; type?: number; status?: number; search?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.type !== undefined) searchParams.set('type', String(params.type));
    if (params?.status !== undefined) searchParams.set('status', String(params.status));
    if (params?.search) searchParams.set('search', params.search);
    const qs = searchParams.toString();
    return this.request(`/api/punishments${qs ? '?' + qs : ''}`);
  }

  async getPunishmentsByAdmin(adminSteamId: string) {
    return this.request(`/api/punishments/admin?admin_steamid=${adminSteamId}`);
  }

  async getAllPunishments(params?: { page?: number; type?: string; status?: string; search?: string; admin_steamid?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.type) searchParams.set('type', params.type);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.admin_steamid) searchParams.set('admin_steamid', params.admin_steamid);
    const qs = searchParams.toString();
    return this.request(`/api/punishments/all${qs ? '?' + qs : ''}`);
  }

  async getStaffStats(steamids: string[]) {
    return this.request(`/api/staff/punishments/staff-stats?steamids=${steamids.join(',')}`);
  }

  async getStaffPunishments(params?: { type?: number; limit?: number; offset?: number; status?: number; search?: string; admin_steamid?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.type !== undefined) searchParams.set('type', String(params.type));
    if (params?.status !== undefined) searchParams.set('status', String(params.status));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    if (params?.search) searchParams.set('search', params.search);
    if (params?.admin_steamid) searchParams.set('admin_steamid', params.admin_steamid);
    const qs = searchParams.toString();
    return this.request(`/api/staff/punishments${qs ? '?' + qs : ''}`);
  }

  async getPunishmentsByAdminPG(adminSteamId: string, type?: number, limit?: number, offset?: number) {
    const searchParams = new URLSearchParams();
    searchParams.set('admin_steamid', adminSteamId);
    if (type !== undefined) searchParams.set('type', String(type));
    if (limit) searchParams.set('limit', String(limit));
    if (offset) searchParams.set('offset', String(offset));
    return this.request(`/api/staff/punishments/by-admin?${searchParams.toString()}`);
  }

  async getPunishmentsBySteamID(steamId: string, type?: number, limit?: number, offset?: number) {
    const searchParams = new URLSearchParams();
    searchParams.set('steamid', steamId);
    if (type !== undefined) searchParams.set('type', String(type));
    if (limit) searchParams.set('limit', String(limit));
    if (offset) searchParams.set('offset', String(offset));
    return this.request(`/api/staff/punishments/by-steamid?${searchParams.toString()}`);
  }

  async getPunishmentsTrend(days?: number) {
    const d = days || 30;
    return this.request(`/api/staff/punishments/trend?days=${d}`);
  }

  async getPunishmentsMonthCompare() {
    return this.request('/api/staff/punishments/month-compare');
  }

  async checkBan(steamId: string) {
    return this.request(`/api/bans/check/${steamId}`);
  }

  async getYoomaBans(steamId: string) {
    return this.request(`/api/yooma/bans/${steamId}`);
  }

  async getSteamSummary(steamId: string) {
    return this.request(`/api/steam/summary/${steamId}`);
  }

  async getSteamSummaries(steamIds: string[]) {
    return this.request(`/api/steam/summaries?steamids=${steamIds.join(',')}`);
  }

  async getSteamBans(steamId: string) {
    return this.request(`/api/steam/bans/${steamId}`);
  }

  async getSteamBansList(steamIds: string[]) {
    return this.request(`/api/steam/bans?steamids=${steamIds.join(',')}`);
  }

  async getSteamFriends(steamId: string) {
    return this.request(`/api/steam/friends/${steamId}`);
  }

  async getSteamLevel(steamId: string) {
    return this.request(`/api/steam/level/${steamId}`);
  }

  async checkAccounts(steamIds: string[]) {
    return this.request('/api/check', {
      method: 'POST',
      body: JSON.stringify({ steam_ids: steamIds }),
    });
  }

  async searchByQuery(query: string) {
    return this.request('/api/check/search', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  }

  async getEvaders() {
    return this.request('/api/evaders');
  }

  async getVDFHistory() {
    return this.request('/api/vdf-history');
  }

  async requestVDFRecheck(checkId: number, steamids: string[]) {
    return this.request('/api/vdf-history/recheck', {
      method: 'POST',
      body: JSON.stringify({ check_id: checkId, steamids }),
    });
  }

  async getVDFRecheckResult(recheckId: number) {
    return this.request(`/api/vdf-history/recheck/result?id=${recheckId}`);
  }

  async downloadVDF(checkId: number, filename = 'config.vdf') {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const res = await fetch(`${API_BASE}/api/vdf-history/download/${checkId}`, {
      method: 'GET',
      headers,
    });
    if (res.status === 401) {
      this.token = null;
      localStorage.removeItem('token');
      window.location.href = '/';
      throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error(`API Error ${res.status}`);
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  async getLogs(params?: { service?: string; level?: string; search?: string; limit?: number; offset?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.service) searchParams.set('service', params.service);
    if (params?.level) searchParams.set('level', params.level);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const qs = searchParams.toString();
    return this.request(`/api/logs${qs ? '?' + qs : ''}`);
  }

  async getLogsStats() {
    return this.request('/api/logs/stats');
  }

  async getLoginHistory(params?: { limit?: number; offset?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const qs = searchParams.toString();
    return this.request(`/api/logs/logins${qs ? '?' + qs : ''}`);
  }

  async getServerActivity(hours?: number) {
    const h = hours || 24;
    return this.request(`/api/server-activity?hours=${h}`);
  }

  async getServerActivitySummary() {
    return this.request('/api/server-activity/summary');
  }

  async getDrops(params?: { date?: string; hours?: number; limit?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.date) searchParams.set('date', params.date);
    if (params?.hours !== undefined) searchParams.set('hours', String(params.hours));
    if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
    const qs = searchParams.toString();
    return this.request(`/api/drops${qs ? '?' + qs : ''}`);
  }

  async getDropsServerStats(params?: { hours?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.hours !== undefined) searchParams.set('hours', String(params.hours));
    const qs = searchParams.toString();
    return this.request(`/api/drops/servers${qs ? '?' + qs : ''}`);
  }

  async getDropsStats(params?: { date?: string; period?: 'today' | 'yesterday' | '7days' | 'week' }) {
    const searchParams = new URLSearchParams();
    if (params?.date) searchParams.set('date', params.date);
    if (params?.period) searchParams.set('period', params.period);
    const qs = searchParams.toString();
    return this.request(`/api/drops/stats${qs ? '?' + qs : ''}`);
  }

  async getDropsLeaderboard() {
    return this.request('/api/drops/leaderboard');
  }

  async getAdminUsers() {
    return this.request('/api/admin/users');
  }

  async getUserSessions(discordId: string, limit?: number) {
    const params = new URLSearchParams();
    params.set('discord_id', discordId);
    if (limit) params.set('limit', String(limit));
    return this.request(`/api/admin/user/sessions?${params.toString()}`);
  }

  async updateUserLevel(discordId: string, level: number, group: string) {
    return this.request('/api/admin/user/level', {
      method: 'POST',
      body: JSON.stringify({ discord_id: discordId, level, group }),
    });
  }

  async blockUser(discordId: string) {
    return this.request('/api/admin/user/block', {
      method: 'POST',
      body: JSON.stringify({ discord_id: discordId }),
    });
  }

  async getWhitelist() {
    return this.request('/api/whitelist');
  }

  async addToWhitelist(steamId: string, name: string) {
    return this.request('/api/whitelist/add', {
      method: 'POST',
      body: JSON.stringify({ steam_id: steamId, name }),
    });
  }

  async deleteFromWhitelist(id: string) {
    return this.request('/api/whitelist/delete', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  }

  async getAdmins() {
    return this.request('/api/admins');
  }

  async resolveNames(ids: string[]) {
    return this.request(`/api/resolve-names?ids=${ids.join(',')}`);
  }

  async checkVDF(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const res = await fetch(`${API_BASE}/api/check/vdf`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) throw new Error(`API Error ${res.status}`);
    return res.json();
  }

  async getHealth() {
    const res = await fetch(`${API_BASE}/api/health`);
    return res.json();
  }
}

export const api = new ApiService();
