-- D1 Schema for pr-visual

CREATE TABLE IF NOT EXISTS processed_prs (
    id TEXT PRIMARY KEY,              -- {installation}:{repo}:{pr}:{sha}
    status TEXT NOT NULL,             -- processing | success | failed
    image_url TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS installations (
    github_installation_id INTEGER PRIMARY KEY,
    polar_customer_id TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_prs_status ON processed_prs(status);
CREATE INDEX IF NOT EXISTS idx_installations_polar ON installations(polar_customer_id);
