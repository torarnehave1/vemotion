CREATE TABLE IF NOT EXISTS compositions (
  id          TEXT PRIMARY KEY,
  user_email  TEXT NOT NULL,
  name        TEXT NOT NULL,
  composition TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_compositions_user ON compositions(user_email);
