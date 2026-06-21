-- Kumiki A/B config store (ARCHITECTURE.md §2a).
-- Normalised, low-volume, human/MCP-edited. The event store (§2b) is a separate
-- substrate (open decision §9.2) and is NOT defined here.

CREATE TABLE site (
  id            TEXT PRIMARY KEY,      -- public id used in the snippet URL
  name          TEXT NOT NULL,
  api_key_hash  TEXT NOT NULL,         -- SHA-256 of the write key (§7 auth)
  created_at    INTEGER NOT NULL
);

CREATE TABLE test (
  id            TEXT PRIMARY KEY,      -- == Test.id in the delivered KumikiConfig
  site_id       TEXT NOT NULL REFERENCES site(id),
  name          TEXT NOT NULL,
  status        TEXT NOT NULL,         -- running | applied | stopped
  coverage      REAL DEFAULT 1,        -- fraction [0,1] entered into the experiment
  winner        TEXT,                  -- variant id, set when status = applied
  conversion_window_days INTEGER NOT NULL DEFAULT 7,  -- W for the user-based window (§4)
  url_match     TEXT,                  -- JSON UrlTargeting | NULL (runs everywhere)
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_test_site ON test (site_id);

CREATE TABLE variant (
  id            TEXT NOT NULL,         -- author-supplied (e.g. "control", "v1")
  test_id       TEXT NOT NULL REFERENCES test(id),
  weight        REAL NOT NULL DEFAULT 1,
  changes       TEXT NOT NULL DEFAULT '[]',  -- JSON Change[]
  position      INTEGER NOT NULL DEFAULT 0,   -- preserves authoring order
  PRIMARY KEY (test_id, id)
);
