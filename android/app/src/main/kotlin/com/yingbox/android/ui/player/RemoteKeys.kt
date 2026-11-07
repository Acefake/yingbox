package com.yingbox.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import com.yingbox.android.playback.engine.RemoteAction
import com.yingbox.android.playback.engine.RemoteKey
import com.yingbox.android.playback.engine.RemoteMode
import com.yingbox.android.playback.engine.remoteAction
import kotlinx.coroutines.delay

/** 遥控器按住左右键后多久没有新的按键就提交跳转（有些遥控器松手不发 KeyUp） */
private const val SCRUB_IDLE_MS = 800L

/** Compose 的按键映射到播放器关心的遥控器键；不关心的键返回 null，交给系统或焦点处理 */
internal fun Key.toRemoteKey(): RemoteKey? = when (this) {
    Key.DirectionLeft -> RemoteKey.Left
    Key.DirectionRight -> RemoteKey.Right
    Key.DirectionUp -> RemoteKey.Up
    Key.DirectionDown -> RemoteKey.Down
    Key.DirectionCenter, Key.Enter, Key.NumPadEnter, Key.MediaPlayPause -> RemoteKey.Center
    Key.Back, Key.Escape -> RemoteKey.Back
    else -> null
}

/** 按住左右键拖进度的一步：第一次按下先记起点，连发次数取系统的 repeatCount + 1，步长随次数加大 */
internal fun Scrubber.remoteStep(event: KeyEvent, direction: Int, positionMs: Long) {
    if (target == null) begin(positionMs)
    step(direction, event.nativeKeyEvent.repeatCount + 1)
}

/**
 * 根容器的遥控器按键：键位表见 [remoteAction]。播放 / 暂停、唤出控制层、打开面板交给 [onAction]；
 * 左右键的拖进度在这里完成，松手（KeyUp）才提交。返回键不在这里处理，交给 BackHandler，
 * 这样控制层、面板、退出三级返回都走系统的返回流程。
 */
internal fun Modifier.remoteKeys(mode: RemoteMode, scrubber: Scrubber, positionMs: () -> Long, onAction: (RemoteAction) -> Unit): Modifier =
    onKeyEvent { event ->
        // 媒体键的播放 / 暂停在任何状态下含义都一样（面板里除外，那里焦点在选项上）
        if (event.key == Key.MediaPlayPause && mode != RemoteMode.Panel) {
            if (event.type == KeyEventType.KeyDown) onAction(RemoteAction.TogglePlay)
            return@onKeyEvent true
        }
        val key = event.key.toRemoteKey()
        if (key == null || key == RemoteKey.Back) return@onKeyEvent false
        val horizontal = key == RemoteKey.Left || key == RemoteKey.Right
        if (event.type == KeyEventType.KeyUp) {
            // commit 幂等：KeyUp 与超时提交先到先得
            if (horizontal) scrubber.commit()
            return@onKeyEvent false
        }
        if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
        // 别的键打断了连发：先把已经拖到的位置跳过去
        if (!horizontal) scrubber.commit()
        when (val action = remoteAction(key, mode)) {
            RemoteAction.None -> false
            is RemoteAction.SeekStep -> {
                scrubber.remoteStep(event, action.direction, positionMs())
                true
            }
            else -> {
                onAction(action)
                true
            }
        }
    }

/** 电视上拖进度停手 [SCRUB_IDLE_MS] 就提交；手机手指按住不动不能提交，所以只在电视上挂 */
@Composable
internal fun ScrubIdleCommit(scrubber: Scrubber) {
    val target = scrubber.target
    LaunchedEffect(target) {
        if (target != null) {
            delay(SCRUB_IDLE_MS)
            scrubber.commit()
        }
    }
}
