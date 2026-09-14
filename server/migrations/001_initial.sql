CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX sessions_by_owner ON sessions(owner_id);

-- IDs are global within each kind, so another owner cannot attach to an ID.
-- Decimal quantities are JSON strings, never floating-point SQLite REALs.
CREATE TABLE entities (
  kind TEXT NOT NULL CHECK(kind IN ('profile','doses','scenarios','favorites','checkins')),
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  revision INTEGER NOT NULL CHECK(revision > 0),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(kind, id)
) STRICT;
CREATE INDEX entities_by_owner ON entities(owner_id, kind, deleted);

CREATE TABLE entity_revisions (
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(kind, entity_id, revision),
  FOREIGN KEY(kind, entity_id) REFERENCES entities(kind, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX revisions_by_owner ON entity_revisions(owner_id, kind, entity_id);
