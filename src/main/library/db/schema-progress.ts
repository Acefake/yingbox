/**
 * v9：观看进度（一条 = 一部电影或一集），规则见 shared/library/watch-progress.ts。
 *
 * 条目被删（重扫后不在了）时级联删掉；文件被删只清 file_id，进度留在条目上。
 * updated_at 是最后观看 / 手动标记的时间，跨库同步时后写胜出。
 */
export const V9_SCHEMA = `
CREATE TABLE watch_progress (
  item_id    INTEGER PRIMARY KEY REFERENCES media_items (id) ON DELETE CASCADE,
  file_id    INTEGER REFERENCES files (id) ON DELETE SET NULL,
  position   REAL    NOT NULL DEFAULT 0,
  duration   REAL    NOT NULL DEFAULT 0,
  watched    INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1)),
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX watch_progress_updated ON watch_progress (updated_at);
`
