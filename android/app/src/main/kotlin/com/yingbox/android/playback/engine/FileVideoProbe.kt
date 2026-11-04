package com.yingbox.android.playback.engine

/** NAS 已探测的单个文件信息；只能绑定到对应文件，不代表任意视频轨或最终输出。 */
data class FileVideoProbe(val fileId: Long, val hdr: HdrKind, val dvProfile: Int?, val dvCompat: Int?)

/** 只有当前输入与文件探测的 DV profile 一致时，才使用该兼容号。 */
fun VideoInfo.baseLayerOf(probe: FileVideoProbe?): HdrKind? {
    if (hdr != HdrKind.DolbyVision || dv == null || probe?.hdr != HdrKind.DolbyVision || dv.profile != probe.dvProfile) return null
    return when (probe.dvCompat) {
        1, 6 -> HdrKind.Hdr10
        2 -> HdrKind.Sdr
        4 -> HdrKind.Hlg
        else -> null
    }
}
