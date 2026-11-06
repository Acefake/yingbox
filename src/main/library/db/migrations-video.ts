/**
 * v8：视频动态范围（ffprobe 探测，见 scanner/video-probe.ts 与 shared/video-range.ts）。
 * video_range 为 NULL 表示还没探测，'' 表示探测过但读不出视频流；内容变了（扫描判定）清回 NULL。
 */
export const V8_SCHEMA = `
ALTER TABLE files ADD COLUMN video_range TEXT
  CHECK (video_range IN ('', 'sdr', 'hdr10', 'hlg', 'dv'));
ALTER TABLE files ADD COLUMN dv_profile INTEGER;
ALTER TABLE files ADD COLUMN dv_compat INTEGER;
CREATE INDEX files_unprobed ON files (library_id)
  WHERE kind = 'video' AND video_range IS NULL;
`
