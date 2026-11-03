package com.yingbox.android.playback.engine

import androidx.media3.common.PlaybackException

/** 播放错误码 → 说得清原因的中文；不认识的带上错误名，方便对日志。 */
fun describeError(code: Int, name: String): String = when (code) {
    PlaybackException.ERROR_CODE_DECODER_INIT_FAILED -> "解码器初始化失败，本设备可能不支持这种编码"
    PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES -> "视频规格超出本设备的解码能力"
    PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> "本设备不支持这种音视频格式"
    PlaybackException.ERROR_CODE_DECODING_FAILED -> "解码失败"
    PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED,
    PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED -> "音频输出失败，请检查音频设备"
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "网络连接失败或超时"
    PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "服务器拒绝了请求"
    PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "文件不存在"
    PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
    PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED -> "不支持这种封装格式，或文件已损坏"
    else -> "播放出错（$name）"
}
