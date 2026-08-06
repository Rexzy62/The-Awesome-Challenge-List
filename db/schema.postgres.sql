CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci ON users (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_ci ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    country_code TEXT,
    identity_name TEXT NOT NULL,
    featured_completion_id TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS levels (
    id TEXT PRIMARY KEY,
    source_slug TEXT UNIQUE,
    rank_position INTEGER NOT NULL,
    name TEXT NOT NULL,
    gd_id TEXT NOT NULL UNIQUE,
    creator_name TEXT NOT NULL,
    creators_json TEXT NOT NULL DEFAULT '[]',
    verifier_name TEXT NOT NULL,
    song_reference TEXT,
    verification_url TEXT,
    notes TEXT NOT NULL DEFAULT '',
    percent_to_qualify INTEGER NOT NULL DEFAULT 100 CHECK (percent_to_qualify BETWEEN 1 AND 100),
    password TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_levels_name_ci ON levels (LOWER(name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_levels_source_slug_ci ON levels (LOWER(source_slug));
CREATE UNIQUE INDEX IF NOT EXISTS idx_levels_gd_id_ci ON levels (LOWER(gd_id));

CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('level', 'run')),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    payload_json TEXT NOT NULL,
    reviewer_id TEXT REFERENCES users(id),
    review_notes TEXT,
    created_at TEXT NOT NULL,
    reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS completions (
    id TEXT PRIMARY KEY,
    source_key TEXT UNIQUE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    player_name TEXT NOT NULL,
    level_id TEXT NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    submission_id TEXT UNIQUE REFERENCES submissions(id) ON DELETE SET NULL,
    proof_url TEXT NOT NULL,
    raw_footage_url TEXT,
    progress_percent INTEGER NOT NULL CHECK (progress_percent BETWEEN 1 AND 100),
    notes TEXT NOT NULL DEFAULT '',
    refresh_rate INTEGER,
    created_at TEXT NOT NULL,
    verified_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_levels_active_rank ON levels(active, rank_position);
CREATE INDEX IF NOT EXISTS idx_submissions_queue ON submissions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_completions_user ON completions(user_id, verified_at);
CREATE INDEX IF NOT EXISTS idx_completions_level ON completions(level_id, progress_percent DESC);
