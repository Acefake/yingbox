/** v17：整理批次记下媒体库来源（jav / tmdb / mixed / unknown），按来源隔离整理记录。 */
export const V17_SCHEMA = `
ALTER TABLE organize_batches ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown';
UPDATE organize_batches SET source = CASE
  WHEN NOT EXISTS (SELECT 1 FROM organize_ops o JOIN libraries l ON l.id = o.library_id WHERE o.batch_id = organize_batches.id) THEN 'unknown'
  WHEN NOT EXISTS (SELECT 1 FROM organize_ops o LEFT JOIN libraries l ON l.id = o.library_id WHERE o.batch_id = organize_batches.id AND (l.source IS NULL OR l.source != 'jav')) THEN 'jav'
  WHEN NOT EXISTS (SELECT 1 FROM organize_ops o LEFT JOIN libraries l ON l.id = o.library_id WHERE o.batch_id = organize_batches.id AND (l.source IS NULL OR l.source = 'jav')) THEN 'tmdb'
  ELSE 'mixed' END;
CREATE INDEX organize_batches_source ON organize_batches(source, id);
`

/**
 * v18：整理步骤多一种「删除」（ADR-0029）：电影的广告小视频、并入剧的家时散存文件夹里片库自己写出的重复 nfo / 图片，
 * 整理时直接删掉，旧文件夹才能清空删除。SQLite 改不了 CHECK，按原结构重建 organize_ops 再拷回数据。
 */
export const V18_SCHEMA = `
CREATE TABLE organize_ops_v18 (
  batch_id   INTEGER NOT NULL REFERENCES organize_batches (id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  item_id    INTEGER NOT NULL,
  library_id INTEGER NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('video', 'sidecar', 'folder', 'delete')),
  src        TEXT    NOT NULL,
  dst        TEXT    NOT NULL,
  cross_device INTEGER NOT NULL DEFAULT 0,
  state      TEXT    NOT NULL DEFAULT 'pending'
             CHECK (state IN ('pending', 'done', 'failed', 'skipped', 'undone')),
  error      TEXT,
  PRIMARY KEY (batch_id, seq)
) STRICT, WITHOUT ROWID;
INSERT INTO organize_ops_v18 SELECT batch_id, seq, item_id, library_id, kind, src, dst,
  cross_device, state, error FROM organize_ops;
DROP TABLE organize_ops;
ALTER TABLE organize_ops_v18 RENAME TO organize_ops;
`
