package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"fearstaff-api/config"
	"fearstaff-api/database"
)

type StaffStatsHandler struct {
	cfg *config.Config
	db  *database.DB
}

func NewStaffStatsHandler(cfg *config.Config, db *database.DB) *StaffStatsHandler {
	return &StaffStatsHandler{cfg: cfg, db: db}
}

func (h *StaffStatsHandler) GetStaffStats(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	adminSteamIDs := r.URL.Query().Get("steamids")
	if adminSteamIDs == "" {
		http.Error(w, `{"error":"steamids required"}`, http.StatusBadRequest)
		return
	}

	ids := strings.Split(adminSteamIDs, ",")
	stats, err := h.db.GetStaffPunishmentStatsDetailed(0)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	// Try to resolve names/avatars from staff table
	staffMap := make(map[string]struct{ name, avatar string })
	if staff, err := h.db.GetAdminsWithProfiles(); err == nil {
		for _, s := range staff {
			sid := ""
			if v, ok := s["steamid"].(string); ok {
				sid = v
			}
			if sid == "" {
				continue
			}
			name := ""
			if v, ok := s["name"].(string); ok {
				name = v
			}
			avatar := ""
			if v, ok := s["avatar"].(string); ok {
				avatar = v
			}
			staffMap[sid] = struct{ name, avatar string }{name, avatar}
		}
	}

	result := make([]interface{}, 0, len(ids))
	for _, sid := range ids {
		sid = strings.TrimSpace(sid)
		if sid == "" {
			continue
		}
		entry := map[string]interface{}{
			"steamid":       sid,
			"total_bans":    0,
			"total_mutes":   0,
			"active_bans":   0,
			"active_mutes":  0,
			"removed_bans":  0,
			"removed_mutes": 0,
			"expired_bans":  0,
			"expired_mutes": 0,
			"bans":          0,
			"mutes":         0,
			"total":         0,
			"active_total":  0,
			"expired_total": 0,
			"removed":       0,
			"name":          "",
			"avatar":        "",
		}
		if s, ok := stats[sid]; ok {
			entry["total_bans"] = s["total_bans"]
			entry["total_mutes"] = s["total_mutes"]
			entry["active_bans"] = s["active_bans"]
			entry["active_mutes"] = s["active_mutes"]
			entry["removed_bans"] = s["removed_bans"]
			entry["removed_mutes"] = s["removed_mutes"]
			entry["expired_bans"] = s["expired_bans"]
			entry["expired_mutes"] = s["expired_mutes"]
			entry["bans"] = s["active_bans"] + s["expired_bans"]
			entry["mutes"] = s["active_mutes"] + s["expired_mutes"]
			entry["total"] = entry["bans"].(int) + entry["mutes"].(int)
			entry["active_total"] = s["active_bans"] + s["active_mutes"]
			entry["expired_total"] = s["expired_bans"] + s["expired_mutes"]
			entry["removed"] = s["removed_bans"] + s["removed_mutes"]
		}
		if info, ok := staffMap[sid]; ok {
			entry["name"] = info.name
			entry["avatar"] = info.avatar
		}
		result = append(result, entry)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"stats":   result,
	})
}

func (h *StaffStatsHandler) GetPunishmentsByAdmin(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	adminSteamID := r.URL.Query().Get("admin_steamid")
	if adminSteamID == "" {
		http.Error(w, `{"error":"admin_steamid required"}`, http.StatusBadRequest)
		return
	}

	ptype, _ := strconv.Atoi(r.URL.Query().Get("type"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 {
		limit = 100
	}

	punishments, err := h.db.GetPunishmentsByAdmin(adminSteamID, ptype, limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"punishments": punishments,
		"total":       len(punishments),
	})
}

func (h *StaffStatsHandler) GetPunishmentsBySteamID(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	steamID := r.URL.Query().Get("steamid")
	if steamID == "" {
		http.Error(w, `{"error":"steamid required"}`, http.StatusBadRequest)
		return
	}

	ptype, _ := strconv.Atoi(r.URL.Query().Get("type"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 {
		limit = 100
	}

	punishments, err := h.db.GetPunishmentsBySteamID(steamID, ptype, limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"punishments": punishments,
		"total":       len(punishments),
	})
}

func (h *StaffStatsHandler) GetPunishmentsTrend(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days <= 0 {
		days = 30
	}

	trend, err := h.db.GetPunishmentsTrend(days)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(trend)
}

func (h *StaffStatsHandler) GetPunishmentsMonthCompare(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	result, err := h.db.GetPunishmentsMonthCompare()
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *StaffStatsHandler) GetPunishmentsList(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		http.Error(w, `{"error":"database not available"}`, http.StatusInternalServerError)
		return
	}

	ptype, _ := strconv.Atoi(r.URL.Query().Get("type"))
	status, _ := strconv.Atoi(r.URL.Query().Get("status"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	adminSteamID := r.URL.Query().Get("admin_steamid")
	search := r.URL.Query().Get("search")
	if limit <= 0 {
		limit = 50
	}

	punishments, err := h.db.GetPunishmentsList(ptype, limit, offset, status, adminSteamID, search)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"punishments": punishments,
		"total":       len(punishments),
	})
}
