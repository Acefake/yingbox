package com.yingbox.android.playback.engine

/** 播放计划是能力判断，不代表最终屏幕已经进入某种 HDR 模式。 */
fun VideoPlan.diagnosticLabel(): String = when (this) {
    VideoPlan.Direct -> "原生播放候选（解码规格仍由播放器核验）"
    VideoPlan.CompatibilityUnknown -> "兼容层未确认"
    is VideoPlan.BaseLayerCandidate -> "${hdr.label} 兼容层候选（实际输出未确认）"
    VideoPlan.DecoderUnsupported -> "未查询到支持当前规格的解码器"
    VideoPlan.DisplayMismatch -> "显示能力不匹配，映射未确认"
    VideoPlan.Unverified -> "信息不足"
    VideoPlan.ColorRisk -> "杜比视界颜色风险"
}

/**
 * 从结构化播放数据生成可复制的报告。仅导出格式和能力，不接收地址、标题、路径或异常原文。
 * 最终显示模式无法从输入格式与解码器名称证明，始终明确列出未确认。
 */
fun playbackDiagnosticReport(stats: StatsSnapshot, caps: Capabilities, plan: VideoPlan): String = buildString {
    appendLine("影盒播放诊断")
    val video = stats.video
    appendLine("片源动态范围：${video?.hdr?.label ?: "未知"}")
    appendLine("视频尺寸：${video?.let { "${it.width}×${it.height}" } ?: "未知"}")
    appendLine("编码：${diagnosticToken(video?.codecs)}")
    appendLine("位深：${video?.bitDepth ?: "未知"}")
    appendLine("帧率：${video?.frameRate ?: "未知"}")
    appendLine("DV Profile / Level：${video?.dv?.let { "${it.profile} / ${it.level}" } ?: "未知"}")
    val source = stats.sourceVideo
    val matchedProbe = source?.takeIf { stats.sourceProbeApplicable && it.hdr == HdrKind.DolbyVision && video?.dv?.profile == it.dvProfile }
    appendLine("基础层兼容 ID：${matchedProbe?.dvCompat ?: "未知"}")
    appendLine("文件探测来源：${if (source != null) "NAS 当前文件的缓存探测" else "无"}")
    appendLine("文件探测可用于当前轨：${matchedProbe != null}")
    appendLine("当前格式原生解码能力：${stats.decoderSupport.native?.let { if (it) "支持已知规格" else "未声明支持" } ?: "未知"}")
    appendLine("兼容层解码能力（Media3 推导）：${stats.decoderSupport.baseLayer?.let { if (it) "支持推导规格" else "未声明支持" } ?: "未知"}")
    appendLine("显示 HDR：${if (caps.displayKnown) caps.displayHdr.joinToString { it.label }.ifEmpty { "无" } else "未知"}")
    appendLine("显示 HDR10+：${if (caps.displayKnown) caps.displayHdr10Plus else "未知"}")
    appendLine("DV 解码 Profile：${caps.dvProfiles.sorted().joinToString().ifEmpty { "未发现" }}")
    appendLine("播放计划：${plan.diagnosticLabel()}")
    appendLine("输出模式未确认")
    appendLine("视频解码器：${diagnosticToken(stats.videoDecoder)}")
    appendLine("音频解码器：${diagnosticToken(stats.audioDecoder)}")
    appendLine("音频格式：${audioCodecName(stats.audioMime) ?: "未知"}")
    appendLine("音频直通能力（不代表已直通）：Atmos=${caps.passthroughAtmos}, TrueHD=${caps.passthroughTrueHd}, DTS-HD=${caps.passthroughDtsHd}")
    appendLine("丢帧：${stats.droppedFrames}，丢帧事件采样合计：${stats.droppedFrameSampleMs} ms")
    appendLine("带宽估计：${stats.bandwidthKbps} kbps（非片源码率）")
}

private fun diagnosticToken(value: String?): String =
    value?.takeIf { it.length <= 160 && it.matches(Regex("[A-Za-z0-9_. ,()-]+")) } ?: "未知"
