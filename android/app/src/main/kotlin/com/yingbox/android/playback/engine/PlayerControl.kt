package com.yingbox.android.playback.engine

/** 电视遥控器当前所处的界面状态：控制层隐藏（播放中）、控制层显示、选项面板打开 */
enum class RemoteMode { Hidden, Controls, Panel }

/** 本播放器关心的遥控器键 */
enum class RemoteKey { Left, Right, Up, Down, Center, Back }

/** 一个遥控器键在当前状态下要做的事；[None] 表示交给焦点所在的组件自己处理 */
sealed interface RemoteAction {
    data object TogglePlay : RemoteAction
    data object ShowControls : RemoteAction
    data object OpenPanel : RemoteAction
    data object ClosePanel : RemoteAction
    data object HideControls : RemoteAction
    data object Exit : RemoteAction
    /** 拖进度一步：[direction] 为 -1（后退）或 1（前进） */
    data class SeekStep(val direction: Int) : RemoteAction
    data object None : RemoteAction
}

/**
 * 遥控器键位表：同一个键在同一状态下只有一种含义。
 * 控制层显示或面板打开时，方向键与确定键交给焦点所在的按钮，只有返回键由这里处理。
 */
fun remoteAction(key: RemoteKey, mode: RemoteMode): RemoteAction = when (mode) {
    RemoteMode.Hidden -> when (key) {
        RemoteKey.Center -> RemoteAction.TogglePlay
        RemoteKey.Up -> RemoteAction.ShowControls
        RemoteKey.Down -> RemoteAction.OpenPanel
        RemoteKey.Left -> RemoteAction.SeekStep(-1)
        RemoteKey.Right -> RemoteAction.SeekStep(1)
        RemoteKey.Back -> RemoteAction.Exit
    }
    RemoteMode.Controls -> if (key == RemoteKey.Back) RemoteAction.HideControls else RemoteAction.None
    RemoteMode.Panel -> if (key == RemoteKey.Back) RemoteAction.ClosePanel else RemoteAction.None
}

/** 按住左右键连发时，第 [pressCount] 次（从 1 起）的步长：前 3 次 10 秒，之后逐级加到 5 分钟封顶 */
fun remoteSeekStep(pressCount: Int): Long = when {
    pressCount <= 3 -> 10_000L
    pressCount <= 7 -> 30_000L
    pressCount <= 13 -> 60_000L
    else -> 300_000L
}

/** 手机横滑拖进度：横滑整屏宽度对应整部片的四分之一，结果限制在 0..[durationMs]；时长未知或宽度为 0 时保持 [startMs] */
fun scrubTarget(startMs: Long, dragPx: Float, widthPx: Float, durationMs: Long): Long {
    if (durationMs <= 0 || widthPx <= 0f) return startMs
    val delta = (dragPx / widthPx * durationMs / 4).toLong()
    return (startMs + delta).coerceIn(0L, durationMs)
}
