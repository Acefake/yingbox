package com.yingbox.android.playback.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayerControlTest {
    @Test fun `隐藏时：确定暂停，上唤出，下开面板，左右拖进度，返回退出`() {
        assertEquals(RemoteAction.TogglePlay, remoteAction(RemoteKey.Center, RemoteMode.Hidden))
        assertEquals(RemoteAction.ShowControls, remoteAction(RemoteKey.Up, RemoteMode.Hidden))
        assertEquals(RemoteAction.OpenPanel, remoteAction(RemoteKey.Down, RemoteMode.Hidden))
        assertEquals(RemoteAction.SeekStep(-1), remoteAction(RemoteKey.Left, RemoteMode.Hidden))
        assertEquals(RemoteAction.SeekStep(1), remoteAction(RemoteKey.Right, RemoteMode.Hidden))
        assertEquals(RemoteAction.Exit, remoteAction(RemoteKey.Back, RemoteMode.Hidden))
    }

    @Test fun `控制层显示时：方向键交给焦点，返回先收起`() {
        assertEquals(RemoteAction.None, remoteAction(RemoteKey.Left, RemoteMode.Controls))
        assertEquals(RemoteAction.None, remoteAction(RemoteKey.Center, RemoteMode.Controls))
        assertEquals(RemoteAction.HideControls, remoteAction(RemoteKey.Back, RemoteMode.Controls))
    }

    @Test fun `面板打开时：返回关面板，其余键交给焦点`() {
        assertEquals(RemoteAction.ClosePanel, remoteAction(RemoteKey.Back, RemoteMode.Panel))
        assertEquals(RemoteAction.None, remoteAction(RemoteKey.Down, RemoteMode.Panel))
    }

    @Test fun `长按连发步长逐级加速并封顶`() {
        assertEquals(10_000L, remoteSeekStep(1))
        assertEquals(10_000L, remoteSeekStep(3))
        assertEquals(30_000L, remoteSeekStep(4))
        assertEquals(60_000L, remoteSeekStep(8))
        assertEquals(300_000L, remoteSeekStep(14))
        assertEquals(300_000L, remoteSeekStep(500))
        assertEquals(10_000L, remoteSeekStep(0))
    }

    @Test fun `横滑换算：整屏宽度对应整部片的四分之一，限制在片内`() {
        // 90 分钟的片，横滑整屏 = 22.5 分钟
        val dur = 5_400_000L
        assertEquals(600_000L + 675_000L, scrubTarget(600_000L, 400f, 800f, dur))
        assertEquals(0L, scrubTarget(60_000L, -800f, 800f, dur))
        assertEquals(dur, scrubTarget(dur - 1_000L, 800f, 800f, dur))
    }

    @Test fun `横滑换算：时长未知或宽度为零时保持原位`() {
        assertEquals(1_000L, scrubTarget(1_000L, 300f, 800f, -1L))
        assertEquals(1_000L, scrubTarget(1_000L, 300f, 0f, 5_000L))
    }
}
