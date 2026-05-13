ALTER TABLE compositions ADD COLUMN current_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS composition_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  composition_id TEXT NOT NULL,
  version        INTEGER NOT NULL,
  name           TEXT NOT NULL,
  composition    TEXT NOT NULL,
  save_type      TEXT NOT NULL DEFAULT 'manual',
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(composition_id, version)
);

CREATE INDEX IF NOT EXISTS idx_composition_history_comp ON composition_history(composition_id, version DESC);
