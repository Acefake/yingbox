/**
 * 版本化迁移：PRAGMA user_version 记录已执行到第几条，启动时按顺序补齐，每条一个事务。
 *
 * 规则：已发布的迁移永远不改，只追加新的。
 */
import type { DatabaseSync } from 'node:sqlite'

/** 一条迁移。 */
export interface Migration {
  /** 从 1 开始连续递增。 */
  version: number
  /** 一句话说明，写进日志。 */
  description: string
  sql: string
}

/**
 * 路径约定：files.path / dirs.path 存“路径键”（正斜杠、无结尾斜杠，Windows 下小写），
 * 唯一索引和子树前缀查询都基于它；display_path 存原始系统路径，给用户看、给 fs 用。
 */
const V1_SCHEMA = `
CREATE TABLE libraries (
  id           INTEGER PRIMARY KEY,
  root         TEXT    NOT NULL UNIQUE,
  root_display TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('movie', 'tv')),
  name         TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  last_scan_at INTEGER
) STRICT;

CREATE TABLE dirs (
  id           INTEGER PRIMARY KEY,
  library_id   INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
  path         TEXT    NOT NULL UNIQUE,
  display_path TEXT    NOT NULL,
  parent       TEXT,
  mtime        REAL    NOT NULL
) STRICT;
CREATE INDEX dirs_parent ON dirs (parent);
CREATE INDEX dirs_library ON dirs (library_id);

CREATE TABLE files (
  id             INTEGER PRIMARY KEY,
  library_id     INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
  path           TEXT    NOT NULL UNIQUE,
  display_path   TEXT    NOT NULL,
  dir            TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  kind           TEXT    NOT NULL CHECK (kind IN ('video', 'nfo', 'image')),
  size           INTEGER NOT NULL,
  mtime          REAL    NOT NULL,
  fingerprint    TEXT,
  parsed         TEXT,
  parser_version INTEGER NOT NULL DEFAULT 0,
  state          TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (state IN ('pending', 'parsed', 'error')),
  added_at       INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
) STRICT;
CREATE INDEX files_dir ON files (dir);
CREATE INDEX files_library ON files (library_id);
CREATE INDEX files_video_size ON files (size) WHERE kind = 'video';
CREATE INDEX files_unfingerprinted ON files (library_id)
  WHERE kind = 'video' AND fingerprint IS NULL;
CREATE INDEX files_stale_parse ON files (parser_version) WHERE kind = 'video';

CREATE TABLE media_items (
  id             INTEGER PRIMARY KEY,
  library_id     INTEGER NOT NULL REFERENCES libraries (id) ON DELETE CASCADE,
  type           TEXT    NOT NULL
                 CHECK (type IN ('movie', 'series', 'season', 'episode')),
  parent_id      INTEGER REFERENCES media_items (id) ON DELETE CASCADE,
  local_key      TEXT    NOT NULL UNIQUE,
  title          TEXT    NOT NULL DEFAULT '',
  original_title TEXT,
  sort_title     TEXT    NOT NULL DEFAULT '',
  search_text    TEXT    NOT NULL DEFAULT '',
  year           INTEGER,
  season_number  INTEGER,
  episode_number INTEGER,
  tmdb_id        TEXT,
  imdb_id        TEXT,
  tvdb_id        TEXT,
  overview       TEXT,
  poster         TEXT,
  match_state    TEXT    NOT NULL DEFAULT 'unmatched'
                 CHECK (match_state IN ('auto', 'review', 'unmatched', 'locked')),
  added_at       INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
) STRICT;
CREATE INDEX media_items_parent ON media_items (parent_id);
CREATE INDEX media_items_title ON media_items (type, sort_title, id);
CREATE INDEX media_items_lib_title ON media_items (library_id, type, sort_title, id);
CREATE INDEX media_items_year ON media_items (type, year, id);
CREATE INDEX media_items_added ON media_items (type, added_at, id);
CREATE INDEX media_items_updated ON media_items (type, updated_at, id);
CREATE INDEX media_items_tmdb ON media_items (tmdb_id) WHERE tmdb_id IS NOT NULL;

CREATE TABLE file_media (
  file_id INTEGER NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES media_items (id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, item_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX file_media_item ON file_media (item_id, file_id);

CREATE TABLE matches (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES media_items (id) ON DELETE CASCADE,
  provider    TEXT    NOT NULL,
  provider_id TEXT    NOT NULL,
  confidence  REAL    NOT NULL,
  status      TEXT    NOT NULL
              CHECK (status IN ('auto', 'review', 'unmatched', 'locked')),
  candidate   TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (item_id, provider, provider_id)
) STRICT;

CREATE TABLE provider_cache (
  key        TEXT    PRIMARY KEY,
  body       TEXT    NOT NULL,
  etag       TEXT,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX provider_cache_expires ON provider_cache (expires_at);

CREATE TABLE jobs (
  id           INTEGER PRIMARY KEY,
  type         TEXT    NOT NULL,
  key          TEXT,
  payload      TEXT    NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 0,
  state        TEXT    NOT NULL
               CHECK (state IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after    INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX jobs_queued_key ON jobs (key) WHERE state = 'queued';
CREATE INDEX jobs_pick ON jobs (state, priority DESC, run_after, id);

-- 片名全文检索：只索引顶层条目；trigram 支持中日韩子串，search_text 已做繁简 / 大小写归一。
CREATE VIRTUAL TABLE media_items_fts USING fts5 (
  search_text,
  content = 'media_items',
  content_rowid = 'id',
  tokenize = 'trigram remove_diacritics 1'
);
CREATE TRIGGER media_items_fts_insert AFTER INSERT ON media_items
WHEN new.type IN ('movie', 'series') BEGIN
  INSERT INTO media_items_fts (rowid, search_text) VALUES (new.id, new.search_text);
END;
CREATE TRIGGER media_items_fts_delete AFTER DELETE ON media_items
WHEN old.type IN ('movie', 'series') BEGIN
  INSERT INTO media_items_fts (media_items_fts, rowid, search_text)
  VALUES ('delete', old.id, old.search_text);
END;
CREATE TRIGGER media_items_fts_update AFTER UPDATE OF search_text ON media_items
WHEN new.type IN ('movie', 'series') BEGIN
  INSERT INTO media_items_fts (media_items_fts, rowid, search_text)
  VALUES ('delete', old.id, old.search_text);
  INSERT INTO media_items_fts (rowid, search_text) VALUES (new.id, new.search_text);
END;
`

/** 全部迁移，按版本升序。 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, description: '初始表结构与片名 FTS', sql: V1_SCHEMA },
]

/** 读取当前 schema 版本。 */
export function schemaVersion(db: DatabaseSync): number {
  return Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
}

/**
 * 执行尚未执行的迁移，返回执行后的版本。
 * 数据库版本高于代码（降级运行）时拒绝打开，避免旧代码写坏新结构。
 */
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS
): number {
  let current = schemaVersion(db)
  const latest = migrations.at(-1)?.version ?? 0
  if (current > latest) {
    throw new Error(
      `媒体库数据库版本 ${current} 高于程序支持的 ${latest}，请升级影盒`
    )
  }
  for (const m of migrations) {
    if (m.version <= current) continue
    if (m.version !== current + 1) {
      throw new Error(`迁移版本不连续：${current} → ${m.version}`)
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(m.sql)
      db.exec(`PRAGMA user_version = ${m.version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(
        `迁移 ${m.version}（${m.description}）失败：${(error as Error).message}`
      )
    }
    current = m.version
  }
  return current
}
