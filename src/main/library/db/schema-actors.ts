/**
 * 演员库的表结构（迁移 V6），单独成文件免得 migrations.ts 超长；规则同 migrations.ts：发布后不改。
 */

/**
 * V6：演员库（番号库）。原来演员只在 media_items.metadata 的 cast 里，这里把「人」单独建表：
 *
 * - actors：一位演员一行，name_key 是归一化名字（NFKC + 小写），同名即同一人；
 *   aliases / images / ids / urls / field_sources / locked_fields 是 JSON；
 *   photo 是首选头像（已缓存为 yingbox-media://，否则远程地址）；
 *   profile_state / profile_at 记录最近一次查资料的结论与时间；
 * - item_actors：顶层条目 ↔ 演员（演员表顺序 ord），由条目元数据的 cast 同步，条目删除级联清理；
 * - actors_fts：名字与别名的 trigram 检索（search_text 已归一化）。
 */
export const V6_SCHEMA = `
CREATE TABLE actors (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  name_key      TEXT    NOT NULL UNIQUE,
  search_text   TEXT    NOT NULL DEFAULT '',
  aliases       TEXT    NOT NULL DEFAULT '[]',
  gender        TEXT    CHECK (gender IN ('female', 'male')),
  birthday      TEXT,
  birthplace    TEXT,
  height        INTEGER,
  bust          INTEGER,
  waist         INTEGER,
  hip           INTEGER,
  cup           TEXT,
  overview      TEXT,
  tagline       TEXT,
  images        TEXT    NOT NULL DEFAULT '[]',
  photo         TEXT,
  ids           TEXT    NOT NULL DEFAULT '{}',
  urls          TEXT    NOT NULL DEFAULT '{}',
  field_sources TEXT    NOT NULL DEFAULT '{}',
  locked_fields TEXT    NOT NULL DEFAULT '[]',
  profile_state TEXT    NOT NULL DEFAULT 'pending'
                CHECK (profile_state IN ('pending', 'found', 'missing', 'error')),
  profile_at    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
) STRICT;
CREATE INDEX actors_pending ON actors (profile_state) WHERE profile_state = 'pending';

CREATE TABLE item_actors (
  item_id  INTEGER NOT NULL REFERENCES media_items (id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES actors (id) ON DELETE CASCADE,
  ord      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, actor_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX item_actors_actor ON item_actors (actor_id, item_id);

CREATE VIRTUAL TABLE actors_fts USING fts5 (
  search_text,
  content = 'actors',
  content_rowid = 'id',
  tokenize = 'trigram remove_diacritics 1'
);
CREATE TRIGGER actors_fts_insert AFTER INSERT ON actors BEGIN
  INSERT INTO actors_fts (rowid, search_text) VALUES (new.id, new.search_text);
END;
CREATE TRIGGER actors_fts_delete AFTER DELETE ON actors BEGIN
  INSERT INTO actors_fts (actors_fts, rowid, search_text)
  VALUES ('delete', old.id, old.search_text);
END;
CREATE TRIGGER actors_fts_update AFTER UPDATE OF search_text ON actors BEGIN
  INSERT INTO actors_fts (actors_fts, rowid, search_text)
  VALUES ('delete', old.id, old.search_text);
  INSERT INTO actors_fts (rowid, search_text) VALUES (new.id, new.search_text);
END;
`
