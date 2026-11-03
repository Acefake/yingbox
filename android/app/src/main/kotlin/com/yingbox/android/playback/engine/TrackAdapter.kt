package com.yingbox.android.playback.engine

import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks

/** 界面里的一条可选轨道 */
data class TrackOption(
    val group: Tracks.Group,
    val trackIndex: Int,
    val label: String,
    val selected: Boolean,
)

/** 某类轨道（[C.TRACK_TYPE_AUDIO] 或 [C.TRACK_TYPE_TEXT]）里设备能放的全部选项 */
fun Tracks.options(trackType: Int): List<TrackOption> = buildList {
    for (group in groups) {
        if (group.type != trackType) continue
        for (i in 0 until group.length) {
            if (!group.isTrackSupported(i)) continue
            val f = group.getTrackFormat(i)
            val d = TrackDescriptor(
                language = f.language,
                label = f.label,
                mimeType = f.sampleMimeType,
                channels = f.channelCount,
                external = f.id?.startsWith(EXTERNAL_ID_PREFIX) == true,
                selected = group.isTrackSelected(i),
            )
            val label = if (trackType == C.TRACK_TYPE_AUDIO) audioLabel(d) else subtitleLabel(d)
            add(TrackOption(group, i, label, d.selected))
        }
    }
}

/** 当前正在播的那一路视频；没有为 null */
fun Tracks.selectedVideo(): VideoInfo? {
    for (group in groups) {
        if (group.type != C.TRACK_TYPE_VIDEO) continue
        for (i in 0 until group.length) {
            if (group.isTrackSelected(i)) return group.getTrackFormat(i).toVideoInfo()
        }
    }
    return null
}

/** 切到某条轨道（同时取消该类轨道的禁用，字幕被关掉后再选能直接显示） */
fun Player.select(option: TrackOption) {
    trackSelectionParameters = trackSelectionParameters.buildUpon()
        .setTrackTypeDisabled(option.group.type, false)
        .setOverrideForType(TrackSelectionOverride(option.group.mediaTrackGroup, option.trackIndex))
        .build()
}

/** 关掉某类轨道（关字幕） */
fun Player.disableTrackType(trackType: Int) {
    trackSelectionParameters = trackSelectionParameters.buildUpon()
        .setTrackTypeDisabled(trackType, true)
        .build()
}
