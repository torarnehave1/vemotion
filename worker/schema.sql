-- Videos: stores composition metadata and render status
CREATE TABLE IF NOT EXISTS videos (
  id          TEXT PRIMARY KEY,
  composition TEXT NOT NULL,           -- JSON blob of CompositionData
  status      TEXT NOT NULL DEFAULT 'queued', -- queued | rendering | done | error
  r2_key      TEXT,                    -- key in VIDEOS R2 bucket once exported
  error       TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);

-- Templates: reusable composition presets
CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  composition TEXT NOT NULL,           -- JSON blob of CompositionData
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Seed a starter template
INSERT OR IGNORE INTO templates (id, name, description, composition) VALUES (
  'template-fade',
  'Simple Fade',
  'White headline that fades in and out over a solid background.',
  '{"duration":5,"fps":30,"width":1280,"height":720,"layers":[{"id":"bg","type":"shape","position":{"x":0,"y":0},"size":{"width":1280,"height":720},"properties":{"shape":"rect","color":"#0f172a"}},{"id":"headline","type":"text","position":{"x":0,"y":300},"size":{"width":1280,"height":120},"properties":{"text":"Your Title Here","fontSize":72,"color":"#ffffff","align":"center","fontWeight":"700"},"animation":{"property":"opacity","keyframes":[{"time":0,"value":0},{"time":1,"value":1},{"time":4,"value":1},{"time":5,"value":0}]}}]}'
);
