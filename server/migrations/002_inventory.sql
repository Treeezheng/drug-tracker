-- SQLite cannot edit an existing CHECK constraint. Rebuild both tables in the
-- enclosing migration transaction, copying every record and revision first.
CREATE TABLE entities_next (
  kind TEXT NOT NULL CHECK(kind IN ('profile','doses','scenarios','favorites','checkins','inventory')),
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  revision INTEGER NOT NULL CHECK(revision > 0),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(kind, id)
) STRICT;
CREATE TABLE entity_revisions_next (
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(kind, entity_id, revision),
  FOREIGN KEY(kind, entity_id) REFERENCES entities_next(kind, id) ON DELETE CASCADE
) STRICT;
INSERT INTO entities_next SELECT * FROM entities;
INSERT INTO entity_revisions_next SELECT * FROM entity_revisions;
DROP TABLE entity_revisions;
DROP TABLE entities;
ALTER TABLE entities_next RENAME TO entities;
ALTER TABLE entity_revisions_next RENAME TO entity_revisions;
CREATE INDEX entities_by_owner ON entities(owner_id, kind, deleted);
CREATE INDEX revisions_by_owner ON entity_revisions(owner_id, kind, entity_id);
