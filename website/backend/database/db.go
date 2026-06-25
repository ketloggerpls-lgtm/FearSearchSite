package database

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"fearstaff-api/models"
)

type DB struct {
	pool      *pgxpool.Pool
	staffFile string
	mu        sync.RWMutex
}

func New(databaseURL string) (*DB, error) {
	if databaseURL == "" {
		log.Println("⚠️ DATABASE_URL not set, using JSON file fallback")
		return &DB{
			staffFile: "staff_db.json",
		}, nil
	}

	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	db := &DB{pool: pool, staffFile: "staff_db.json"}

	if err := db.migrate(); err != nil {
		return nil, fmt.Errorf("migration failed: %w", err)
	}

	return db, nil
}

func (db *DB) migrate() error {
	ctx := context.Background()
	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id SERIAL PRIMARY KEY,
			discord_id VARCHAR(64) UNIQUE NOT NULL,
			username VARCHAR(255) NOT NULL,
			display_name VARCHAR(255),
			avatar TEXT,
			email VARCHAR(255),
			staff_group VARCHAR(64),
			staff_role VARCHAR(128),
			steam_id VARCHAR(64),
			level INTEGER DEFAULT 0,
			permissions JSONB DEFAULT '[]',
			guild_roles JSONB DEFAULT '[]',
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW(),
			last_login TIMESTAMPTZ
		)`,
		`CREATE TABLE IF NOT EXISTS login_history (
			id SERIAL PRIMARY KEY,
			discord_id VARCHAR(64) NOT NULL,
			ip_address VARCHAR(64),
			user_agent TEXT,
			logged_in_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS kv_store (
			key TEXT PRIMARY KEY,
			value JSONB NOT NULL,
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS whitelist (
			id SERIAL PRIMARY KEY,
			steam_id VARCHAR(64) UNIQUE NOT NULL,
			name VARCHAR(255),
			added_by VARCHAR(255),
			added_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS profile_cache (
			steam_id VARCHAR(64) PRIMARY KEY,
			name VARCHAR(255),
			avatar TEXT,
			fetched_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS staff_list (
			steam_id VARCHAR(64) PRIMARY KEY,
			name VARCHAR(255),
			nickname VARCHAR(255),
			discord_id VARCHAR(64),
			discord_name VARCHAR(255),
			group_name VARCHAR(64),
			group_display_name VARCHAR(128),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS vdf_checks (
			id SERIAL PRIMARY KEY,
			check_id INTEGER UNIQUE,
			filename VARCHAR(255),
			timestamp TIMESTAMPTZ DEFAULT NOW(),
			attachment_url TEXT,
			message_url TEXT,
			results JSONB DEFAULT '[]',
			steamids TEXT[] DEFAULT '{}',
			banned_count INTEGER DEFAULT 0,
			last_recheck TIMESTAMPTZ
		)`,
		`CREATE TABLE IF NOT EXISTS app_logs (
			id SERIAL PRIMARY KEY,
			service VARCHAR(64),
			level VARCHAR(16),
			message TEXT,
			data JSONB,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS config_hashes (
			id SERIAL PRIMARY KEY,
			config_hash VARCHAR(64) UNIQUE NOT NULL,
			filename TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS config_accounts (
			id SERIAL PRIMARY KEY,
			config_hash VARCHAR(64) NOT NULL REFERENCES config_hashes(config_hash) ON DELETE CASCADE,
			steamid VARCHAR(32) NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE(config_hash, steamid)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_config_accounts_steamid ON config_accounts(steamid)`,
		`CREATE TABLE IF NOT EXISTS drops (
			id SERIAL PRIMARY KEY,
			drop_id BIGINT UNIQUE NOT NULL,
			steamid VARCHAR(32),
			name VARCHAR(255),
			price NUMERIC DEFAULT 0,
			image TEXT,
			rarity_color VARCHAR(32),
			server_id VARCHAR(64),
			server_name VARCHAR(255),
			created_at TIMESTAMPTZ DEFAULT NOW(),
			created_at_ts BIGINT,
			raw_json JSONB
		)`,
		`CREATE INDEX IF NOT EXISTS idx_drops_created_at_ts ON drops(created_at_ts DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_drops_steamid ON drops(steamid)`,
		`CREATE INDEX IF NOT EXISTS idx_drops_server_id ON drops(server_id)`,
		`CREATE TABLE IF NOT EXISTS vdf_history (
			id SERIAL PRIMARY KEY,
			check_id INTEGER,
			steamid VARCHAR(32) NOT NULL,
			nickname TEXT,
			fear_banned BOOLEAN DEFAULT FALSE,
			fear_reason TEXT,
			fear_unban_time TEXT,
			vac_banned BOOLEAN DEFAULT FALSE,
			vac_days_ago INTEGER DEFAULT 0,
			game_bans INTEGER DEFAULT 0,
			yooma_banned BOOLEAN DEFAULT FALSE,
			yooma_reason TEXT,
			admin_group TEXT,
			config_hash VARCHAR(64),
			filename TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_vdf_history_steamid ON vdf_history(steamid)`,
		`CREATE INDEX IF NOT EXISTS idx_vdf_history_check_id ON vdf_history(check_id)`,
		`ALTER TABLE vdf_history ADD COLUMN IF NOT EXISTS attachment_url TEXT`,
		`ALTER TABLE vdf_history ADD COLUMN IF NOT EXISTS message_url TEXT`,
		`ALTER TABLE vdf_history ADD COLUMN IF NOT EXISTS on_fear BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE config_hashes ADD COLUMN IF NOT EXISTS content TEXT`,
		`CREATE TABLE IF NOT EXISTS profiles (
			steamid TEXT PRIMARY KEY,
			name TEXT,
			last_activity TIMESTAMPTZ,
			avatar_full TEXT,
			discord_nickname TEXT,
			discord_id TEXT,
			rank INTEGER,
			kills INTEGER,
			deaths INTEGER,
			playtime INTEGER,
			ban_is_banned BOOLEAN,
			vip_is_vip BOOLEAN,
			faceit_level INTEGER,
			faceit_elo INTEGER,
			report_count INTEGER DEFAULT 0,
			raw_json JSONB,
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS reports (
			id BIGINT PRIMARY KEY,
			steamid VARCHAR(32) NOT NULL,
			intruder_name VARCHAR(255),
			intruder_avatar TEXT,
			sender VARCHAR(255),
			sender_steamid VARCHAR(32),
			reason TEXT,
			created_at TIMESTAMPTZ,
			raw_json JSONB,
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_reports_steamid ON reports(steamid)`,
		`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS faceit_level INTEGER`,
		`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS faceit_elo INTEGER`,
		`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS report_count INTEGER DEFAULT 0`,
		// Shared tables created by bot, ensured here for fresh backend deployments
		`CREATE TABLE IF NOT EXISTS punishments (
			id BIGINT PRIMARY KEY,
			type SMALLINT NOT NULL CHECK (type IN (1, 2)),
			steamid VARCHAR(32) NOT NULL,
			name VARCHAR(255),
			admin VARCHAR(255),
			admin_steamid VARCHAR(32),
			admin_avatar TEXT,
			avatar TEXT,
			reason TEXT,
			status INTEGER,
			duration INTEGER,
			created BIGINT,
			expires BIGINT,
			unban_price INTEGER,
			raw_json JSONB,
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_punishments_type_created ON punishments(type, created DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_punishments_steamid ON punishments(steamid)`,
		`CREATE INDEX IF NOT EXISTS idx_punishments_admin_steamid ON punishments(admin_steamid)`,
	}

	for _, q := range queries {
		if _, err := db.pool.Exec(ctx, q); err != nil {
			return fmt.Errorf("migration query failed: %w\nQuery: %s", err, q)
		}
	}

	// Migrate legacy drops column name from created_at_ms to created_at_ts (bot uses ts)
	if _, err := db.pool.Exec(ctx, `
		DO $$
		BEGIN
			IF EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_name = 'drops' AND column_name = 'created_at_ms'
			) AND NOT EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_name = 'drops' AND column_name = 'created_at_ts'
			) THEN
				ALTER TABLE drops RENAME COLUMN created_at_ms TO created_at_ts;
			END IF;
		END $$;
	`); err != nil {
		log.Printf("⚠️ drops column migration skipped: %v", err)
	}

	log.Println("✅ Database migration completed")
	return nil
}

func (db *DB) Close() {
	if db.pool != nil {
		db.pool.Close()
	}
}

func (db *DB) UpsertUser(user *models.User) error {
	if db.pool == nil {
		return db.upsertUserJSON(user)
	}

	ctx := context.Background()
	permJSON, _ := json.Marshal(user.Permissions)
	rolesJSON, _ := json.Marshal(user.GuildRoles)

	_, err := db.pool.Exec(ctx, `
		INSERT INTO users (discord_id, username, display_name, avatar, email, staff_group, staff_role, steam_id, level, permissions, guild_roles, created_at, updated_at, last_login)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		ON CONFLICT (discord_id) DO UPDATE SET
			username = EXCLUDED.username,
			display_name = EXCLUDED.display_name,
			avatar = EXCLUDED.avatar,
			email = EXCLUDED.email,
			staff_group = EXCLUDED.staff_group,
			staff_role = EXCLUDED.staff_role,
			steam_id = EXCLUDED.steam_id,
			level = EXCLUDED.level,
			permissions = EXCLUDED.permissions,
			guild_roles = EXCLUDED.guild_roles,
			updated_at = NOW(),
			last_login = NOW()
	`,
		user.DiscordID, user.Username, user.DisplayName, user.Avatar, user.Email,
		user.StaffGroup, user.StaffRole, user.SteamID, user.Level,
		permJSON, rolesJSON, user.CreatedAt, user.UpdatedAt, user.LastLogin,
	)
	return err
}

func (db *DB) GetUserByDiscordID(discordID string) (*models.User, error) {
	if db.pool == nil {
		return db.getUserByDiscordIDJSON(discordID)
	}

	ctx := context.Background()
	var user models.User
	var permJSON, rolesJSON []byte

	err := db.pool.QueryRow(ctx, `
		SELECT discord_id, username, display_name, avatar, email, staff_group, staff_role, steam_id, level, permissions, guild_roles, created_at, updated_at, last_login
		FROM users WHERE discord_id = $1
	`, discordID).Scan(
		&user.DiscordID, &user.Username, &user.DisplayName, &user.Avatar,
		&user.Email, &user.StaffGroup, &user.StaffRole, &user.SteamID,
		&user.Level, &permJSON, &rolesJSON, &user.CreatedAt, &user.UpdatedAt, &user.LastLogin,
	)
	if err != nil {
		return nil, err
	}

	_ = json.Unmarshal(permJSON, &user.Permissions)
	_ = json.Unmarshal(rolesJSON, &user.GuildRoles)
	return &user, nil
}

func (db *DB) GetPublicUserByID(id string) (map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	var (
		discordID, username, displayName, avatar, staffGroup, staffRole, steamID string
		level                                                                   int
		rolesJSON                                                               []byte
		lastLogin                                                               interface{}
	)
	where := "discord_id = $1"
	if isSteamID(id) {
		where = "steam_id = $1"
	}
	err := db.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT discord_id, username, display_name, avatar, staff_group, staff_role, steam_id, level, guild_roles, last_login
		FROM users WHERE %s
	`, where), id).Scan(
		&discordID, &username, &displayName, &avatar, &staffGroup, &staffRole, &steamID, &level, &rolesJSON, &lastLogin,
	)
	if err != nil {
		return nil, err
	}
	var guildRoles []string
	_ = json.Unmarshal(rolesJSON, &guildRoles)
	result := map[string]interface{}{
		"discord_id":   discordID,
		"username":     username,
		"display_name": displayName,
		"avatar":       avatar,
		"staff_group":  staffGroup,
		"staff_role":   staffRole,
		"steam_id":     steamID,
		"level":        level,
		"guild_roles":  guildRoles,
		"last_login":   fmt.Sprintf("%v", lastLogin),
	}
	return result, nil
}

func isSteamID(s string) bool {
	return len(s) >= 17 && s[:2] == "76" && len(s) <= 18
}

func (db *DB) GetAllUsers() ([]models.User, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database available")
	}

	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT discord_id, username, display_name, avatar, staff_group, staff_role, steam_id, level, permissions, guild_roles, last_login
		FROM users ORDER BY last_login DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var u models.User
		var permJSON, rolesJSON []byte
		_ = rows.Scan(
			&u.DiscordID, &u.Username, &u.DisplayName, &u.Avatar,
			&u.StaffGroup, &u.StaffRole, &u.SteamID, &u.Level,
			&permJSON, &rolesJSON, &u.LastLogin,
		)
		_ = json.Unmarshal(permJSON, &u.Permissions)
		_ = json.Unmarshal(rolesJSON, &u.GuildRoles)
		users = append(users, u)
	}
	return users, nil
}

func (db *DB) LogLogin(discordID, ip, userAgent string) {
	if db.pool == nil {
		return
	}
	ctx := context.Background()
	_, _ = db.pool.Exec(ctx, `
		INSERT INTO login_history (discord_id, ip_address, user_agent) VALUES ($1, $2, $3)
	`, discordID, ip, userAgent)
}

func (db *DB) SearchSteamIDs(query string) ([]string, error) {
	if db.pool == nil {
		return db.searchSteamIDsJSON(query)
	}
	ctx := context.Background()
	q := "%" + query + "%"

	ids := make([]string, 0)

	rows, err := db.pool.Query(ctx, `
		SELECT DISTINCT steam_id FROM users
		WHERE (steam_id ILIKE $1 OR discord_id ILIKE $1 OR username ILIKE $1 OR display_name ILIKE $1)
		AND steam_id IS NOT NULL AND steam_id != ''
	`, q)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var sid string
			if err := rows.Scan(&sid); err == nil && sid != "" {
				ids = append(ids, sid)
			}
		}
	}

	if len(ids) == 0 {
		rows2, err2 := db.pool.Query(ctx, `
			SELECT DISTINCT steam_id FROM staff_list
			WHERE (steam_id ILIKE $1 OR name ILIKE $1 OR nickname ILIKE $1 OR discord_id ILIKE $1 OR discord_name ILIKE $1)
			AND steam_id IS NOT NULL AND steam_id != ''
		`, q)
		if err2 == nil {
			defer rows2.Close()
			for rows2.Next() {
				var sid string
				if err := rows2.Scan(&sid); err == nil && sid != "" {
					ids = append(ids, sid)
				}
			}
		}
	}

	return ids, nil
}

func (db *DB) GetKVStore(key string) ([]byte, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database available")
	}
	ctx := context.Background()
	var value []byte
	err := db.pool.QueryRow(ctx, `SELECT value FROM kv_store WHERE key = $1`, key).Scan(&value)
	if err != nil {
		return nil, err
	}
	return value, nil
}

func (db *DB) SetKVStore(key string, value []byte) error {
	if db.pool == nil {
		return fmt.Errorf("no database available")
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `
		INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, NOW())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`, key, value)
	return err
}

func (db *DB) UpsertStaffList(staff []map[string]interface{}) error {
	if db.pool == nil {
		return nil
	}
	ctx := context.Background()

	for _, s := range staff {
		sid := ""
		if v, ok := s["steamid"].(string); ok {
			sid = v
		} else if v, ok := s["steam_id"].(string); ok {
			sid = v
		}
		if sid == "" {
			continue
		}
		name := getString(s, "name")
		nickname := getString(s, "nickname")
		discordID := fmt.Sprintf("%v", s["discord_id"])
		discordName := getString(s, "discord_nickname")
		groupName := getString(s, "group_name")
		groupDisplayName := getString(s, "group_display_name")

		_, err := db.pool.Exec(ctx, `
			INSERT INTO staff_list (steam_id, name, nickname, discord_id, discord_name, group_name, group_display_name, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
			ON CONFLICT (steam_id) DO UPDATE SET
				name = EXCLUDED.name, nickname = EXCLUDED.nickname,
				discord_id = EXCLUDED.discord_id, discord_name = EXCLUDED.discord_name,
				group_name = EXCLUDED.group_name, group_display_name = EXCLUDED.group_display_name,
				updated_at = NOW()
		`, sid, name, nickname, discordID, discordName, groupName, groupDisplayName)
		if err != nil {
			log.Printf("⚠️ UpsertStaffList error for %s: %v", sid, err)
		}
	}
	return nil
}

func (db *DB) GetStaffListFromDB() ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT steam_id, name, nickname, discord_id, discord_name, group_name, group_display_name FROM staff_list
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var steamID, name, nickname, discordID, discordName, groupName, groupDisplayName string
		if err := rows.Scan(&steamID, &name, &nickname, &discordID, &discordName, &groupName, &groupDisplayName); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"steamid":             steamID,
			"name":                name,
			"nickname":            nickname,
			"discord_id":          discordID,
			"discord_nickname":    discordName,
			"group_name":          groupName,
			"group_display_name":  groupDisplayName,
		})
	}
	return result, nil
}

func (db *DB) GetProfilesBatch(steamIDs []string) (map[string]ProfileCache, error) {
	if db.pool == nil || len(steamIDs) == 0 {
		return nil, nil
	}
	ctx := context.Background()
	result := make(map[string]ProfileCache)

	rows, err := db.pool.Query(ctx, `
		SELECT steam_id, name, avatar FROM profile_cache
		WHERE steam_id = ANY($1) AND fetched_at > NOW() - INTERVAL '24 hours'
	`, steamIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var pc ProfileCache
		if err := rows.Scan(&pc.SteamID, &pc.Name, &pc.Avatar); err == nil {
			result[pc.SteamID] = pc
		}
	}
	return result, nil
}

func (db *DB) UpsertProfileCache(steamID, name, avatar string) {
	if db.pool == nil {
		return
	}
	ctx := context.Background()
	_, _ = db.pool.Exec(ctx, `
		INSERT INTO profile_cache (steam_id, name, avatar, fetched_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (steam_id) DO UPDATE SET name = EXCLUDED.name, avatar = EXCLUDED.avatar, fetched_at = NOW()
	`, steamID, name, avatar)
}

func (db *DB) GetPlayersEnrich(steamIDs []string) (map[string]map[string]interface{}, error) {
	if db.pool == nil || len(steamIDs) == 0 {
		return nil, nil
	}
	ctx := context.Background()
	result := make(map[string]map[string]interface{})

	rows, err := db.pool.Query(ctx, `
		SELECT p.steamid, p.faceit_level, p.faceit_elo, p.report_count,
		       (SELECT COUNT(*)::int FROM reports r WHERE r.steamid = p.steamid AND r.created_at > NOW() - INTERVAL '24 hours') as reports_24h
		FROM profiles p
		WHERE p.steamid = ANY($1)
	`, steamIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var sid string
		var faceitLevel, faceitElo, reportCount, reports24h *int
		if err := rows.Scan(&sid, &faceitLevel, &faceitElo, &reportCount, &reports24h); err != nil {
			continue
		}
		result[sid] = map[string]interface{}{
			"faceit_level":  faceitLevel,
			"faceit_elo":    faceitElo,
			"report_count":  reportCount,
			"reports_24h":   reports24h,
		}
	}

	// Also include report counts for players without a profile row
	rows2, err := db.pool.Query(ctx, `
		SELECT r.steamid, COUNT(*)::int
		FROM reports r
		WHERE r.steamid = ANY($1) AND r.created_at > NOW() - INTERVAL '24 hours'
		GROUP BY r.steamid
	`, steamIDs)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var sid string
			var cnt int
			if err := rows2.Scan(&sid, &cnt); err != nil {
				continue
			}
			if _, ok := result[sid]; !ok {
				result[sid] = map[string]interface{}{}
			}
			result[sid]["reports_24h"] = cnt
		}
	}
	return result, nil
}

type ProfileCache struct {
	SteamID string
	Name    string
	Avatar  string
}

func (db *DB) UpsertWhitelist(steamID, name, addedBy string) error {
	if db.pool == nil {
		return fmt.Errorf("no database")
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `
		INSERT INTO whitelist (steam_id, name, added_by, added_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (steam_id) DO UPDATE SET name = EXCLUDED.name, added_by = EXCLUDED.added_by, added_at = NOW()
	`, steamID, name, addedBy)
	return err
}

func (db *DB) DeleteWhitelist(steamID string) error {
	if db.pool == nil {
		return fmt.Errorf("no database")
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `DELETE FROM whitelist WHERE steam_id = $1`, steamID)
	return err
}

func (db *DB) GetWhitelist() ([]WhitelistEntryDB, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT steam_id, name, added_by, added_at::text FROM whitelist ORDER BY added_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []WhitelistEntryDB
	for rows.Next() {
		var e WhitelistEntryDB
		if err := rows.Scan(&e.SteamID, &e.Name, &e.AddedBy, &e.Date); err == nil {
			entries = append(entries, e)
		}
	}
	return entries, nil
}

type WhitelistEntryDB struct {
	SteamID string
	Name    string
	AddedBy string
	Date    string
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func (db *DB) searchSteamIDsJSON(query string) ([]string, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()

	path := db.staffFile
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, nil
	}

	var data map[string]staffDBEntry
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, nil
	}

	var ids []string
	q := query
	for sid, entry := range data {
		if entry.Name == q || entry.DiscordID == q || entry.DiscordName == q || sid == q {
			ids = append(ids, sid)
		}
	}
	return ids, nil
}

type staffDBEntry struct {
	Name        string `json:"name"`
	DiscordID   string `json:"discord_id"`
	DiscordName string `json:"discord_name"`
	Role        string `json:"role"`
	GroupName   string `json:"group_name"`
	UpdatedAt   string `json:"updated_at"`
}

func (db *DB) upsertUserJSON(user *models.User) error {
	db.mu.Lock()
	defer db.mu.Unlock()

	path := db.staffFile
	data := make(map[string]staffDBEntry)

	if raw, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(raw, &data)
	}

	key := user.SteamID
	if key == "" {
		key = user.DiscordID
	}

	data[key] = staffDBEntry{
		Name:        user.DisplayName,
		DiscordID:   user.DiscordID,
		DiscordName: user.Username,
		Role:        user.StaffRole,
		GroupName:   user.StaffGroup,
		UpdatedAt:   time.Now().UTC().Format(time.RFC3339),
	}

	raw, _ := json.MarshalIndent(data, "", "  ")
	return os.WriteFile(path, raw, 0644)
}

func (db *DB) getUserByDiscordIDJSON(discordID string) (*models.User, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()

	path := db.staffFile
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("staff file not found")
	}

	var data map[string]staffDBEntry
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}

	for _, entry := range data {
		if entry.DiscordID == discordID {
			return &models.User{
				DiscordID:   entry.DiscordID,
				Username:    entry.DiscordName,
				DisplayName: entry.Name,
				StaffGroup:  entry.GroupName,
				StaffRole:   entry.Role,
			}, nil
		}
	}
	return nil, fmt.Errorf("user not found")
}

func (db *DB) GetStaffFromFile() (map[string]models.StaffMember, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()

	path := db.staffFile
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]models.StaffMember{}, nil
		}
		return nil, err
	}

	var data map[string]staffDBEntry
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}

	result := make(map[string]models.StaffMember)
	for k, v := range data {
		result[k] = models.StaffMember{
			SteamID:     k,
			Name:        v.Name,
			DiscordID:   v.DiscordID,
			DiscordName: v.DiscordName,
			Role:        v.Role,
			GroupName:   v.GroupName,
			UpdatedAt:   v.UpdatedAt,
		}
	}
	return result, nil
}

func getcwd() string {
	dir, _ := filepath.Abs(".")
	return dir
}

func (db *DB) SaveVDFCheck(checkID int, filename, attachmentURL, messageURL string, results []byte, steamids []string, bannedCount int) error {
	if db.pool == nil {
		return db.saveVDFCheckKV(checkID, filename, attachmentURL, messageURL, results, steamids, bannedCount)
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `
		INSERT INTO vdf_checks (check_id, filename, timestamp, attachment_url, message_url, results, steamids, banned_count)
		VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7)
		ON CONFLICT (check_id) DO UPDATE SET
			filename = EXCLUDED.filename,
			attachment_url = EXCLUDED.attachment_url,
			message_url = EXCLUDED.message_url,
			results = EXCLUDED.results,
			steamids = EXCLUDED.steamids,
			banned_count = EXCLUDED.banned_count,
			last_recheck = NOW()
	`, checkID, filename, attachmentURL, messageURL, results, steamids, bannedCount)
	return err
}

func (db *DB) GetVDFChecks() ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT check_id, filename, timestamp, attachment_url, message_url, results, steamids, banned_count, COALESCE(last_recheck::text, '')
		FROM vdf_checks ORDER BY check_id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var checks []map[string]interface{}
	for rows.Next() {
		var checkID int
		var filename, attachmentURL, messageURL, lastRecheck string
		var timestamp interface{}
		var results []byte
		var steamids []string
		var bannedCount int
		if err := rows.Scan(&checkID, &filename, &timestamp, &attachmentURL, &messageURL, &results, &steamids, &bannedCount, &lastRecheck); err != nil {
			continue
		}
		checks = append(checks, map[string]interface{}{
			"check_id":       checkID,
			"filename":       filename,
			"timestamp":      fmt.Sprintf("%v", timestamp),
			"attachment_url": attachmentURL,
			"message_url":    messageURL,
			"results":        json.RawMessage(results),
			"steamids":       steamids,
			"banned_count":   bannedCount,
			"last_recheck":   lastRecheck,
		})
	}
	return checks, nil
}

// ── Logs ────────────────────────────────────────────────────────────────────

func (db *DB) GetLogs(service, level, search string, limit, offset int) ([]map[string]interface{}, int, error) {
	if db.pool == nil {
		return nil, 0, fmt.Errorf("no database")
	}
	ctx := context.Background()

	where := "1=1"
	args := []interface{}{}
	argIdx := 1

	if service != "" {
		where += fmt.Sprintf(" AND service = $%d", argIdx)
		args = append(args, service)
		argIdx++
	}
	if level != "" {
		where += fmt.Sprintf(" AND level = $%d", argIdx)
		args = append(args, level)
		argIdx++
	}
	if search != "" {
		where += fmt.Sprintf(" AND message ILIKE $%d", argIdx)
		args = append(args, "%"+search+"%")
		argIdx++
	}

	var total int
	countQuery := fmt.Sprintf("SELECT COUNT(*)::int FROM app_logs WHERE %s", where)
	err := db.pool.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT id, service, level, message, data, created_at::text
		FROM app_logs WHERE %s
		ORDER BY id DESC LIMIT $%d OFFSET $%d
	`, where, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var id int
		var svc, lvl, msg, createdAt string
		var data []byte
		if err := rows.Scan(&id, &svc, &lvl, &msg, &data, &createdAt); err != nil {
			continue
		}
		entry := map[string]interface{}{
			"id":         id,
			"service":    svc,
			"level":      lvl,
			"message":    msg,
			"created_at": createdAt,
		}
		if len(data) > 0 {
			entry["data"] = json.RawMessage(data)
		}
		result = append(result, entry)
	}
	return result, total, nil
}

func (db *DB) GetLogsStats() (map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()

	var totalCount, todayCount, errorCount int
	_ = db.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM app_logs`).Scan(&totalCount)
	_ = db.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM app_logs WHERE created_at > NOW() - INTERVAL '1 day'`).Scan(&todayCount)
	_ = db.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM app_logs WHERE level = 'error' AND created_at > NOW() - INTERVAL '7 days'`).Scan(&errorCount)

	services := make(map[string]int)
	rows, err := db.pool.Query(ctx, `SELECT service, COUNT(*)::int as cnt FROM app_logs GROUP BY service ORDER BY cnt DESC`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var svc string
			var cnt int
			if err := rows.Scan(&svc, &cnt); err == nil {
				services[svc] = cnt
			}
		}
	}

	return map[string]interface{}{
		"total":     totalCount,
		"today":     todayCount,
		"errors_7d": errorCount,
		"services":  services,
	}, nil
}

func (db *DB) GetLoginHistory(limit, offset int) ([]map[string]interface{}, int, error) {
	if db.pool == nil {
		return nil, 0, fmt.Errorf("no database")
	}
	ctx := context.Background()

	var total int
	_ = db.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM login_history`).Scan(&total)

	rows, err := db.pool.Query(ctx, `
		SELECT lh.discord_id, lh.ip_address, lh.user_agent, lh.logged_in_at::text,
		       COALESCE(u.username, '') as username,
		       COALESCE(u.display_name, '') as display_name,
		       COALESCE(u.avatar, '') as avatar
		FROM login_history lh
		LEFT JOIN users u ON u.discord_id = lh.discord_id
		ORDER BY lh.id DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var discordID, ip, userAgent, loggedAt, username, displayName, avatar string
		if err := rows.Scan(&discordID, &ip, &userAgent, &loggedAt, &username, &displayName, &avatar); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"discord_id":   discordID,
			"ip_address":   ip,
			"user_agent":   userAgent,
			"logged_in_at": loggedAt,
			"username":     username,
			"display_name": displayName,
			"avatar":       avatar,
		})
	}
	return result, total, nil
}

func (db *DB) GetUserLoginHistory(discordID string, limit int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := db.pool.Query(ctx, `
		SELECT lh.ip_address, lh.user_agent, lh.logged_in_at::text,
		       COALESCE(u.steam_id, '') as steam_id
		FROM login_history lh
		LEFT JOIN users u ON u.discord_id = lh.discord_id
		WHERE lh.discord_id = $1
		ORDER BY lh.id DESC
		LIMIT $2
	`, discordID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var ip, userAgent, loggedAt, steamID string
		if err := rows.Scan(&ip, &userAgent, &loggedAt, &steamID); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"ip_address":   ip,
			"user_agent":   userAgent,
			"logged_in_at": loggedAt,
			"steam_id":     steamID,
		})
	}
	return result, nil
}

func (db *DB) saveVDFCheckKV(checkID int, filename, attachmentURL, messageURL string, results []byte, steamids []string, bannedCount int) error {
	data, err := db.GetKVStore("vdf_checks.json")
	if err != nil {
		data = []byte(`{"checks":{}}`)
	}
	var store map[string]interface{}
	if err := json.Unmarshal(data, &store); err != nil {
		store = map[string]interface{}{"checks": map[string]interface{}{}}
	}
	checks, _ := store["checks"].(map[string]interface{})
	checkKey := fmt.Sprintf("%d", checkID)
	checks[checkKey] = map[string]interface{}{
		"filename":       filename,
		"timestamp":      time.Now().UTC().Format(time.RFC3339),
		"attachment_url": attachmentURL,
		"message_url":    messageURL,
		"results":        json.RawMessage(results),
		"steamids":       steamids,
		"banned_count":   bannedCount,
	}
	store["checks"] = checks
	raw, _ := json.Marshal(store)
	return db.SetKVStore("vdf_checks.json", raw)
}

func (db *DB) LogService(service, level, message string, data interface{}) {
	if db.pool == nil {
		return
	}
	ctx := context.Background()
	var dataJSON []byte
	if data != nil {
		dataJSON, _ = json.Marshal(data)
	}
	_, _ = db.pool.Exec(ctx, `
		INSERT INTO app_logs (service, level, message, data, created_at)
		VALUES ($1, $2, $3, $4, NOW())
	`, service, level, message, dataJSON)
}

func (db *DB) GetNextCheckID() (int, error) {
	if db.pool == nil {
		return 1, nil
	}
	ctx := context.Background()
	var maxID int
	err := db.pool.QueryRow(ctx, `SELECT COALESCE(MAX(check_id), 0) FROM vdf_checks`).Scan(&maxID)
	if err != nil {
		return 1, nil
	}
	return maxID + 1, nil
}

func (db *DB) SaveConfigAccounts(configHash string, steamIDs []string, filename string, content string) error {
	if db.pool == nil {
		return nil
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `
		INSERT INTO config_hashes (config_hash, filename, content, created_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (config_hash) DO UPDATE SET filename = EXCLUDED.filename, content = EXCLUDED.content
	`, configHash, filename, content)
	if err != nil {
		return err
	}
	for _, sid := range steamIDs {
		_, _ = db.pool.Exec(ctx, `
			INSERT INTO config_accounts (config_hash, steamid, created_at)
			VALUES ($1, $2, NOW())
			ON CONFLICT (config_hash, steamid) DO NOTHING
		`, configHash, sid)
	}
	return nil
}

func (db *DB) GetLinkedSteamIDs(steamID string) ([]string, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT DISTINCT ca2.steamid
		FROM config_accounts ca1
		JOIN config_accounts ca2 ON ca1.config_hash = ca2.config_hash
		WHERE ca1.steamid = $1
		ORDER BY ca2.steamid
	`, steamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err == nil {
			ids = append(ids, sid)
		}
	}
	return ids, nil
}

func (db *DB) SaveVDFHistoryEntry(checkID int, steamID, nickname string, fearBanned bool, fearReason, fearUnbanTime string, vacBanned bool, vacDaysAgo, gameBans int, yoomaBanned bool, yoomaReason, adminGroup, configHash, filename string, onFear bool) error {
	if db.pool == nil {
		return nil
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `
		INSERT INTO vdf_history
			(check_id, steamid, nickname, fear_banned, fear_reason, fear_unban_time,
			 vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
			 admin_group, config_hash, filename, on_fear, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
	`, checkID, steamID, nickname, fearBanned, fearReason, fearUnbanTime,
		vacBanned, vacDaysAgo, gameBans, yoomaBanned, yoomaReason,
		adminGroup, configHash, filename, onFear)
	return err
}

func (db *DB) GetVDFHistoryDetailed() ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT steamid, nickname, fear_banned, fear_reason, fear_unban_time,
		       vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
		       admin_group, config_hash, filename, check_id, created_at::text,
		       attachment_url, message_url, on_fear
		FROM vdf_history
		ORDER BY id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var (
			steamID, nickname, fearReason, fearUnbanTime, yoomaReason string
			adminGroup, configHash, filename, createdAt              string
			attachmentURL, messageURL                                string
			fearBanned, vacBanned, yoomaBanned, onFear             bool
			vacDaysAgo, gameBans, checkID                            int
		)
		if err := rows.Scan(&steamID, &nickname, &fearBanned, &fearReason, &fearUnbanTime,
			&vacBanned, &vacDaysAgo, &gameBans, &yoomaBanned, &yoomaReason,
			&adminGroup, &configHash, &filename, &checkID, &createdAt,
			&attachmentURL, &messageURL, &onFear); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"steamid":         steamID,
			"nickname":        nickname,
			"fear_banned":     fearBanned,
			"fear_reason":     fearReason,
			"fear_unban_time": fearUnbanTime,
			"vac_banned":      vacBanned,
			"vac_days_ago":    vacDaysAgo,
			"game_bans":       gameBans,
			"yooma_banned":    yoomaBanned,
			"yooma_reason":    yoomaReason,
			"admin_group":     adminGroup,
			"config_hash":     configHash,
			"filename":        filename,
			"check_id":        checkID,
			"created_at":      createdAt,
			"attachment_url":  attachmentURL,
			"message_url":     messageURL,
			"on_fear":         onFear,
		})
	}
	return result, nil
}

func (db *DB) GetVDFHistoryBySteamID(steamID string, limit int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT steamid, nickname, fear_banned, fear_reason, fear_unban_time,
		       vac_banned, vac_days_ago, game_bans, yooma_banned, yooma_reason,
		       admin_group, config_hash, filename, check_id, created_at::text, on_fear
		FROM vdf_history
		WHERE steamid = $1
		ORDER BY id DESC
		LIMIT $2
	`, steamID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var (
			sid, nickname, fearReason, fearUnbanTime, yoomaReason string
			adminGroup, configHash, filename, createdAt          string
			fearBanned, vacBanned, yoomaBanned, onFear         bool
			vacDaysAgo, gameBans, checkID                        int
		)
		if err := rows.Scan(&sid, &nickname, &fearBanned, &fearReason, &fearUnbanTime,
			&vacBanned, &vacDaysAgo, &gameBans, &yoomaBanned, &yoomaReason,
			&adminGroup, &configHash, &filename, &checkID, &createdAt, &onFear); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"steamid":        sid,
			"nickname":       nickname,
			"fear_banned":    fearBanned,
			"fear_reason":    fearReason,
			"fear_unban_time": fearUnbanTime,
			"vac_banned":     vacBanned,
			"vac_days_ago":   vacDaysAgo,
			"game_bans":      gameBans,
			"yooma_banned":   yoomaBanned,
			"yooma_reason":   yoomaReason,
			"admin_group":    adminGroup,
			"config_hash":    configHash,
			"filename":       filename,
			"check_id":       checkID,
			"created_at":     createdAt,
			"on_fear":        onFear,
		})
	}
	return result, nil
}

// ── VDF Rechecks ────────────────────────────────────────────────────────────

func (db *DB) CreateVDFRecheck(checkID int, steamIDs []string) (int, error) {
	if db.pool == nil {
		return 0, fmt.Errorf("no database")
	}
	ctx := context.Background()

	var existingID int
	err := db.pool.QueryRow(ctx, `
		SELECT id FROM vdf_rechecks
		WHERE check_id = $1 AND status = 'pending'
		ORDER BY requested_at DESC
		LIMIT 1
	`, checkID).Scan(&existingID)
	if err == nil && existingID > 0 {
		return existingID, fmt.Errorf("already pending")
	}

	var id int
	err = db.pool.QueryRow(ctx, `
		INSERT INTO vdf_rechecks (check_id, steamids, status)
		VALUES ($1, $2, 'pending') RETURNING id
	`, checkID, steamIDs).Scan(&id)
	return id, err
}

func (db *DB) GetPendingVDFRechecks() ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT id, check_id, steamids, status, requested_at::text
		FROM vdf_rechecks WHERE status = 'pending'
		ORDER BY requested_at ASC LIMIT 10
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var id, checkID int
		var steamIDs []string
		var status, requestedAt string
		if err := rows.Scan(&id, &checkID, &steamIDs, &status, &requestedAt); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"id":            id,
			"check_id":      checkID,
			"steamids":      steamIDs,
			"status":        status,
			"requested_at":  requestedAt,
		})
	}
	return result, nil
}

func (db *DB) GetVDFRecheckResult(recheckID int) (map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	var (
		id, checkID                    int
		steamIDs                       []string
		status                         string
		results                        []byte
		errorMsg                       *string
		requestedAt, startedAt, completedAt string
	)
	err := db.pool.QueryRow(ctx, `
		SELECT id, check_id, steamids, status, results, error,
		       COALESCE(requested_at::text, ''), COALESCE(started_at::text, ''), COALESCE(completed_at::text, '')
		FROM vdf_rechecks WHERE id = $1
	`, recheckID).Scan(&id, &checkID, &steamIDs, &status, &results, &errorMsg, &requestedAt, &startedAt, &completedAt)
	if err != nil {
		return nil, err
	}
	result := map[string]interface{}{
		"id":            id,
		"check_id":      checkID,
		"steamids":      steamIDs,
		"status":        status,
		"results":       json.RawMessage(results),
		"requested_at":  requestedAt,
		"started_at":    startedAt,
		"completed_at":  completedAt,
	}
	if errorMsg != nil {
		result["error"] = *errorMsg
	}
	return result, nil
}

func (db *DB) GetConfigAccounts(configHash string) ([]string, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT steamid FROM config_accounts WHERE config_hash = $1 ORDER BY steamid
	`, configHash)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err == nil {
			ids = append(ids, sid)
		}
	}
	return ids, nil
}

func (db *DB) GetVDFContentByCheckID(checkID int) (filename, content string, err error) {
	if db.pool == nil {
		return "", "", fmt.Errorf("no database")
	}
	ctx := context.Background()
	var configHash string
	err = db.pool.QueryRow(ctx, `
		SELECT COALESCE((
			SELECT config_hash FROM vdf_history WHERE check_id = $1 LIMIT 1
		), '')
	`, checkID).Scan(&configHash)
	if err != nil || configHash == "" {
		return "", "", fmt.Errorf("config not found")
	}
	err = db.pool.QueryRow(ctx, `
		SELECT COALESCE(filename, 'config.vdf'), COALESCE(content, '')
		FROM config_hashes WHERE config_hash = $1
	`, configHash).Scan(&filename, &content)
	if err != nil {
		return "", "", err
	}
	return filename, content, nil
}

func (db *DB) UpdateVDFHistoryBan(steamID string, fearBanned bool, fearReason, fearUnbanTime string) error {
	if db.pool == nil {
		return nil
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `
		UPDATE vdf_history
		SET fear_banned = $2, fear_reason = $3, fear_unban_time = $4
		WHERE steamid = $1
	`, steamID, fearBanned, fearReason, fearUnbanTime)
	return err
}

// ── Shared tables: admins, profiles, punishments (written by bot) ───────────

func (db *DB) GetPunishmentsByAdmin(adminSteamID string, ptype int, limit, offset int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	var rows pgx.Rows
	var err error
	if ptype > 0 {
		rows, err = db.pool.Query(ctx, `
			SELECT id, type, steamid, name, admin, admin_steamid, reason, status, duration, created, expires, updated_at
			FROM punishments WHERE admin_steamid = $1 AND type = $2
			ORDER BY created DESC LIMIT $3 OFFSET $4
		`, adminSteamID, ptype, limit, offset)
	} else {
		rows, err = db.pool.Query(ctx, `
			SELECT id, type, steamid, name, admin, admin_steamid, reason, status, duration, created, expires, updated_at
			FROM punishments WHERE admin_steamid = $1
			ORDER BY created DESC LIMIT $2 OFFSET $3
		`, adminSteamID, limit, offset)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPunishmentRows(rows)
}

func (db *DB) GetStaffPunishmentStats(since int64) (map[string]map[string]int, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT admin_steamid, type, COUNT(*)::int as count
		FROM punishments WHERE created >= $1 AND admin_steamid != ''
		GROUP BY admin_steamid, type
	`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats := make(map[string]map[string]int)
	for rows.Next() {
		var adminSteam string
		var ptype, count int
		if err := rows.Scan(&adminSteam, &ptype, &count); err != nil {
			continue
		}
		if stats[adminSteam] == nil {
			stats[adminSteam] = make(map[string]int)
		}
		switch ptype {
		case 1:
			stats[adminSteam]["bans"] = count
		case 2:
			stats[adminSteam]["mutes"] = count
		}
		stats[adminSteam]["total"] += count
	}
	return stats, nil
}

func (db *DB) GetStaffPunishmentStatsDetailed(since int64) (map[string]map[string]int, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT admin_steamid, type, status, COUNT(*)::int as count
		FROM punishments WHERE created >= $1 AND admin_steamid != ''
		GROUP BY admin_steamid, type, status
	`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats := make(map[string]map[string]int)
	for rows.Next() {
		var adminSteam string
		var ptype, status, count int
		if err := rows.Scan(&adminSteam, &ptype, &status, &count); err != nil {
			continue
		}
		if stats[adminSteam] == nil {
			stats[adminSteam] = map[string]int{
				"total_bans": 0, "total_mutes": 0,
				"active_bans": 0, "active_mutes": 0,
				"removed_bans": 0, "removed_mutes": 0,
				"expired_bans": 0, "expired_mutes": 0,
			}
		}
		isBan := ptype == 1
		switch status {
		case 1:
			if isBan {
				stats[adminSteam]["active_bans"] += count
			} else {
				stats[adminSteam]["active_mutes"] += count
			}
		case 2:
			if isBan {
				stats[adminSteam]["removed_bans"] += count
			} else {
				stats[adminSteam]["removed_mutes"] += count
			}
		case 4:
			if isBan {
				stats[adminSteam]["expired_bans"] += count
			} else {
				stats[adminSteam]["expired_mutes"] += count
			}
		}
		if isBan {
			stats[adminSteam]["total_bans"] += count
		} else {
			stats[adminSteam]["total_mutes"] += count
		}
	}
	return stats, nil
}

func (db *DB) GetPunishmentsTrend(days int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT
			to_timestamp(created)::date as day,
			COUNT(*) FILTER (WHERE type = 1) as bans,
			COUNT(*) FILTER (WHERE type = 2) as mutes,
			COUNT(*) as total
		FROM punishments
		WHERE created >= EXTRACT(EPOCH FROM NOW() - ($1 || ' days')::INTERVAL)
		GROUP BY day ORDER BY day ASC
	`, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var day interface{}
		var bans, mutes, total int
		if err := rows.Scan(&day, &bans, &mutes, &total); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"day":   fmt.Sprintf("%v", day),
			"bans":  bans,
			"mutes": mutes,
			"total": total,
		})
	}
	return result, nil
}

func (db *DB) GetPunishmentsMonthCompare() (map[string]map[string]int, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	result := map[string]map[string]int{
		"current":  {"bans": 0, "mutes": 0, "total": 0},
		"previous": {"bans": 0, "mutes": 0, "total": 0},
	}
	var currBans, currMutes, currTotal int
	err := db.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE type = 1),
			COUNT(*) FILTER (WHERE type = 2),
			COUNT(*)
		FROM punishments
		WHERE to_char(to_timestamp(created), 'YYYY-MM') = to_char(NOW(), 'YYYY-MM')
	`).Scan(&currBans, &currMutes, &currTotal)
	if err == nil {
		result["current"] = map[string]int{"bans": currBans, "mutes": currMutes, "total": currTotal}
	}
	var prevBans, prevMutes, prevTotal int
	err = db.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE type = 1),
			COUNT(*) FILTER (WHERE type = 2),
			COUNT(*)
		FROM punishments
		WHERE to_char(to_timestamp(created), 'YYYY-MM') = to_char(NOW() - INTERVAL '1 month', 'YYYY-MM')
	`).Scan(&prevBans, &prevMutes, &prevTotal)
	if err == nil {
		result["previous"] = map[string]int{"bans": prevBans, "mutes": prevMutes, "total": prevTotal}
	}
	return result, nil
}

func (db *DB) GetAdminsWithProfiles() ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT a.admin_id, a.steamid, a.group_display_name, a.group_name,
		       a.immunity, a.is_frozen, a.avatar_full,
		       COALESCE(p.name, a.raw_json->>'name') AS name,
		       COALESCE(p.avatar_full, a.avatar_full) AS avatar,
		       p.rank, p.kills, p.deaths, p.playtime,
		       p.discord_nickname, p.discord_id,
		       p.ban_is_banned, p.vip_is_vip,
		       GREATEST(a.updated_at, COALESCE(p.updated_at, a.updated_at)) AS updated_at
		FROM admins a LEFT JOIN profiles p ON p.steamid = a.steamid
		ORDER BY a.admin_id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []map[string]interface{}
	for rows.Next() {
		var (
			adminID                                     int
			steamid, groupDisplayName, groupName        string
			immunity                                    int
			isFrozen                                    bool
			avatarFull, name, avatar                    string
			rank                                        *int
			kills, deaths, playtime                     *int
			discordNickname, discordID                  *string
			banIsBanned, vipIsVip                       *bool
			updatedAt                                   interface{}
		)
		if err := rows.Scan(&adminID, &steamid, &groupDisplayName, &groupName,
			&immunity, &isFrozen, &avatarFull,
			&name, &avatar, &rank, &kills, &deaths, &playtime,
			&discordNickname, &discordID, &banIsBanned, &vipIsVip, &updatedAt); err != nil {
			continue
		}
		entry := map[string]interface{}{
			"admin_id":          adminID,
			"steamid":           steamid,
			"group_display_name": groupDisplayName,
			"group_name":        groupName,
			"immunity":          immunity,
			"is_frozen":         isFrozen,
			"avatar_full":       avatarFull,
			"name":              name,
			"avatar":            avatar,
			"updated_at":        fmt.Sprintf("%v", updatedAt),
		}
		if rank != nil {
			entry["rank"] = *rank
		}
		if kills != nil {
			entry["kills"] = *kills
		}
		if deaths != nil {
			entry["deaths"] = *deaths
		}
		if playtime != nil {
			entry["playtime"] = *playtime
		}
		if discordNickname != nil {
			entry["discord_nickname"] = *discordNickname
		}
		if discordID != nil {
			entry["discord_id"] = *discordID
		}
		if banIsBanned != nil {
			entry["ban_is_banned"] = *banIsBanned
		}
		if vipIsVip != nil {
			entry["vip_is_vip"] = *vipIsVip
		}
		result = append(result, entry)
	}
	return result, nil
}

func (db *DB) GetPunishmentsList(ptype int, limit, offset int, status int, adminSteamID, search string) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	args := []interface{}{}
	where := []string{}
	if ptype > 0 {
		args = append(args, ptype)
		where = append(where, fmt.Sprintf("type = $%d", len(args)))
	}
	if status > 0 {
		args = append(args, status)
		where = append(where, fmt.Sprintf("status = $%d", len(args)))
	}
	if adminSteamID != "" {
		args = append(args, adminSteamID)
		where = append(where, fmt.Sprintf("admin_steamid = $%d", len(args)))
	}
	if search != "" {
		args = append(args, "%"+search+"%", "%"+search+"%", "%"+search+"%", "%"+search+"%")
		start := len(args) - 3
		where = append(where, fmt.Sprintf(
			"(name ILIKE $%d OR steamid ILIKE $%d OR admin ILIKE $%d OR reason ILIKE $%d)",
			start, start+1, start+2, start+3))
	}
	query := "SELECT id, type, steamid, name, admin, admin_steamid, reason, status, duration, created, expires, updated_at FROM punishments"
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	args = append(args, limit, offset)
	query += fmt.Sprintf(" ORDER BY created DESC LIMIT $%d OFFSET $%d", len(args)-1, len(args))
	rows, err := db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPunishmentRows(rows)
}

func (db *DB) GetPunishmentsBySteamID(steamID string, ptype int, limit, offset int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	var rows pgx.Rows
	var err error
	if ptype > 0 {
		rows, err = db.pool.Query(ctx, `
			SELECT id, type, steamid, name, admin, admin_steamid, reason, status, duration, created, expires, updated_at
			FROM punishments WHERE steamid = $1 AND type = $2
			ORDER BY created DESC LIMIT $3 OFFSET $4
		`, steamID, ptype, limit, offset)
	} else {
		rows, err = db.pool.Query(ctx, `
			SELECT id, type, steamid, name, admin, admin_steamid, reason, status, duration, created, expires, updated_at
			FROM punishments WHERE steamid = $1
			ORDER BY created DESC LIMIT $2 OFFSET $3
		`, steamID, limit, offset)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPunishmentRows(rows)
}

func scanPunishmentRows(rows pgx.Rows) ([]map[string]interface{}, error) {
	var result []map[string]interface{}
	for rows.Next() {
		var (
			id, duration, created, expires            int64
			ptype, status                             int
			steamid, name, admin, adminSteam, reason string
			updatedAt                                 interface{}
		)
		if err := rows.Scan(&id, &ptype, &steamid, &name, &admin, &adminSteam,
			&reason, &status, &duration, &created, &expires, &updatedAt); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"id":              id,
			"type":            ptype,
			"steamid":         steamid,
			"name":            name,
			"admin":           admin,
			"admin_name":      admin,
			"admin_steamid":   adminSteam,
			"reason":          reason,
			"status":          status,
			"duration":        duration,
			"created":         created,
			"time":            time.Unix(created, 0).Format("2006-01-02T15:04:05Z"),
			"expires":         expires,
			"updated_at":      fmt.Sprintf("%v", updatedAt),
		})
	}
	return result, nil
}

// ── Server Activity ─────────────────────────────────────────────────────────

func (db *DB) GetServerActivity(hours int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT timestamp, hour, total_players, total_admins, server_data
		FROM panel_server_activity
		WHERE timestamp > EXTRACT(EPOCH FROM NOW() - ($1 || ' hours')::INTERVAL)
		ORDER BY timestamp ASC
	`, hours)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var ts, hour, totalPlayers, totalAdmins int
		var serverData string
		if err := rows.Scan(&ts, &hour, &totalPlayers, &totalAdmins, &serverData); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"timestamp":     ts,
			"hour":          hour,
			"total_players": totalPlayers,
			"total_admins":  totalAdmins,
			"server_data":   serverData,
		})
	}
	return result, nil
}

func (db *DB) GetServerActivitySummary() (map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()

	var maxPlayers, avgPlayers, totalSnapshots int
	_ = db.pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(total_players), 0), COALESCE(AVG(total_players)::int, 0), COUNT(*)::int
		FROM panel_server_activity WHERE timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')
	`).Scan(&maxPlayers, &avgPlayers, &totalSnapshots)

	var maxAdmins, avgAdmins, currentAdmins int
	_ = db.pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(total_admins), 0), COALESCE(AVG(total_admins)::int, 0), COALESCE((ARRAY_AGG(total_admins ORDER BY id DESC))[1], 0)
		FROM panel_server_activity WHERE timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')
	`).Scan(&maxAdmins, &avgAdmins, &currentAdmins)

	var lastPlayers int
	_ = db.pool.QueryRow(ctx, `
		SELECT total_players FROM panel_server_activity ORDER BY id DESC LIMIT 1
	`).Scan(&lastPlayers)

	hourly := make(map[string]int)
	rows, err := db.pool.Query(ctx, `
		SELECT hour, COALESCE(AVG(total_players)::int, 0) as avg_p
		FROM panel_server_activity
		WHERE timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')
		GROUP BY hour ORDER BY hour
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var h, avg int
			if err := rows.Scan(&h, &avg); err == nil {
				hourly[fmt.Sprintf("%02d", h)] = avg
			}
		}
	}

	return map[string]interface{}{
		"max_24h":        maxPlayers,
		"avg_24h":        avgPlayers,
		"current":        lastPlayers,
		"current_admins": currentAdmins,
		"max_admins_24h": maxAdmins,
		"avg_admins_24h": avgAdmins,
		"snapshots_24h":  totalSnapshots,
		"hourly":         hourly,
	}, nil
}

// SaveDrop сохраняет один дроп в БД.
func (db *DB) SaveDrop(dropID int64, steamid, name string, price float64, image, rarityColor, serverID, serverName string, createdAt time.Time, createdAtMs int64, raw []byte) error {
	if db.pool == nil {
		return fmt.Errorf("no database")
	}
	ctx := context.Background()
	_, err := db.pool.Exec(ctx, `
		INSERT INTO drops (drop_id, steamid, name, price, image, rarity_color, server_id, server_name, created_at, created_at_ts, raw_json)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (drop_id) DO UPDATE SET
			steamid = EXCLUDED.steamid,
			name = EXCLUDED.name,
			price = EXCLUDED.price,
			image = EXCLUDED.image,
			rarity_color = EXCLUDED.rarity_color,
			server_id = EXCLUDED.server_id,
			server_name = EXCLUDED.server_name,
			created_at = EXCLUDED.created_at,
			created_at_ts = EXCLUDED.created_at_ts,
			raw_json = EXCLUDED.raw_json
	`, dropID, steamid, name, price, image, rarityColor, serverID, serverName, createdAt, createdAtMs, raw)
	return err
}

// GetDropsFromDB возвращает дропы из БД за период.
func (db *DB) GetDropsFromDB(since time.Time, limit int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT drop_id, steamid, name, price, image, rarity_color, server_id, server_name, created_at, created_at_ts, raw_json
		FROM drops
		WHERE created_at >= $1
		ORDER BY created_at_ts DESC
		LIMIT $2
	`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []map[string]interface{}
	for rows.Next() {
		var dropID int64
		var steamid, name, image, rarityColor, serverID, serverName string
		var createdAt time.Time
		var createdAtMs int64
		var raw []byte
		var price float64
		if err := rows.Scan(&dropID, &steamid, &name, &price, &image, &rarityColor, &serverID, &serverName, &createdAt, &createdAtMs, &raw); err != nil {
			continue
		}
		createdStr := ""
		if createdAtMs > 0 {
			createdStr = time.UnixMilli(createdAtMs).UTC().Format("2006-01-02T15:04:05Z")
		} else if !createdAt.IsZero() {
			createdStr = createdAt.UTC().Format("2006-01-02T15:04:05Z")
		}
		items = append(items, map[string]interface{}{
			"id":           dropID,
			"steamid":      steamid,
			"name":         name,
			"price":        price,
			"image":        image,
			"rarity_color": rarityColor,
			"server_id":    serverID,
			"server_name":  serverName,
			"created_at":   createdStr,
		})
	}
	return items, nil
}

// GetDropsStatsFromDB возвращает статистику дропов по дням из БД.
func (db *DB) GetDropsStatsFromDB(start, end time.Time) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT DATE(created_at) as d, COUNT(*) as total, COALESCE(SUM(price), 0) as total_value, COUNT(DISTINCT steamid) as unique_players, MAX(price) as max_price
		FROM drops
		WHERE created_at >= $1 AND created_at <= $2
		GROUP BY DATE(created_at)
		ORDER BY d DESC
	`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []map[string]interface{}
	for rows.Next() {
		var date time.Time
		var total int
		var totalValue, maxPrice float64
		var uniquePlayers int
		if err := rows.Scan(&date, &total, &totalValue, &uniquePlayers, &maxPrice); err != nil {
			continue
		}
		avg := 0.0
		if total > 0 {
			avg = totalValue / float64(total)
		}
		stats = append(stats, map[string]interface{}{
			"date":           date.Format("2006-01-02"),
			"total_drops":    total,
			"total_value":    totalValue,
			"unique_players": uniquePlayers,
			"average_value":  avg,
			"most_expensive": maxPrice,
		})
	}
	return stats, nil
}

// DropServerStats возвращает статистику дропов по серверам.
func (db *DB) DropServerStats(since time.Time, limit int) ([]map[string]interface{}, error) {
	if db.pool == nil {
		return nil, fmt.Errorf("no database")
	}
	ctx := context.Background()
	rows, err := db.pool.Query(ctx, `
		SELECT COALESCE(server_name, 'Неизвестно') as sname, COUNT(*) as drops, COUNT(DISTINCT steamid) as players, SUM(price) as value
		FROM drops
		WHERE created_at >= $1 AND server_id IS NOT NULL
		GROUP BY server_name
		ORDER BY drops DESC
		LIMIT $2
	`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var sname string
		var drops, players int
		var value float64
		if err := rows.Scan(&sname, &drops, &players, &value); err != nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"server_name":    sname,
			"server_id":      sname,
			"drops_count":    drops,
			"unique_players": players,
			"total_value":    value,
		})
	}
	return result, nil
}
