package com.yingbox.android.playback.engine

import androidx.annotation.OptIn
import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import android.view.animation.DecelerateInterpolator
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer

/**
 * 按档位和当前视频规格设置 FSR 放大（EASU）与锐化（RCAS）；不满足条件时清空应用效果列表。
 * 相同方案不重复下发，避免每次轨道回调都重建视频处理链。
 */
@OptIn(UnstableApi::class)
class VideoEnhancer(private val player: ExoPlayer, private val displayHeight: Int) {
    private var applied: EnhancePlan? = null
    private val handler = Handler(Looper.getMainLooper())
    private var generation = 0
    private var restarting = false

    /** 擦除线位置：线左边是增强后的画面；GL 线程每帧读取 */
    @Volatile
    private var wipe = 1f
    private var animator: ValueAnimator? = null

    /** 正在按住看原画 */
    var comparing by mutableStateOf(false)
        private set
    var status by mutableStateOf("")
        private set

    fun update(level: EnhanceLevel, video: VideoInfo?) {
        val plan = enhancePlan(level, video, displayHeight)
        if (restarting) return
        if (plan == null) {
            generation++
            handler.removeCallbacksAndMessages(null)
            animator?.cancel()
            comparing = false
            wipe = 1f
            if (applied != null) player.setVideoEffects(emptyList())
            applied = null
            status = if (level == EnhanceLevel.Off) "" else if (video == null) "等待画面" else "已旁路"
            return
        }
        if (plan == applied) return
        applied = plan
        wipe = 0f
        val current = ++generation
        status = "准备中"
        handler.removeCallbacksAndMessages(null)
        player.setVideoEffects(effects(plan) {
            handler.post {
                if (current == generation) {
                    status = "FSR"
                    animateWipe(1f, REVEAL_MS)
                }
            }
        })
        restartVideoRenderer()
        handler.postDelayed({
            if (current == generation && status == "准备中") status = if (player.playWhenReady) "未生效" else "待播放"
        }, 8_000)
    }

    /**
     * ExoPlayer 只在视频渲染器启动时建立特效处理链：画面已经在播时才设特效，不会生效。
     * 关闭再打开视频轨会重建渲染器（解码器重新创建，画面短暂停顿一下）。
     */
    private fun restartVideoRenderer() {
        val params = player.trackSelectionParameters
        restarting = true
        player.trackSelectionParameters = params.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, true).build()
        handler.postDelayed({
            player.trackSelectionParameters = params
            handler.postDelayed({ restarting = false }, RESTART_SETTLE_MS)
        }, RESTART_GAP_MS)
    }

    private fun effects(plan: EnhancePlan, onRendered: () -> Unit): List<Effect> = buildList {
        plan.targetHeight?.let { add(EasuEffect(it) { wipe }) }
        add(RcasEffect(plan.strength, onRendered) { wipe })
    }

    /** 按住看原画：擦除线向左扫到头；松开后扫回右边，恢复增强画面 */
    fun setCompare(on: Boolean) {
        if (status != "FSR") return
        comparing = on
        animateWipe(if (on) 0f else 1f, COMPARE_MS)
    }

    private fun animateWipe(to: Float, ms: Long) {
        animator?.cancel()
        animator = ValueAnimator.ofFloat(wipe, to).apply {
            duration = ms
            interpolator = DecelerateInterpolator()
            addUpdateListener { wipe = it.animatedValue as Float }
            // 暂停时没有新帧，动画结束后补一次原地定位，让最终画面刷新
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    if (!player.isPlaying) player.seekTo(player.currentPosition)
                }
            })
            start()
        }
    }

    fun reset() {
        if (applied != null) player.setVideoEffects(emptyList())
        dispose()
    }

    fun onPlayWhenReadyChanged(ready: Boolean) {
        if (!ready || status != "待播放") return
        val current = generation
        status = "准备中"
        handler.postDelayed({
            if (current == generation && status == "准备中") status = if (player.playWhenReady) "未生效" else "待播放"
        }, 8_000)
    }

    fun dispose() {
        generation++
        handler.removeCallbacksAndMessages(null)
        animator?.cancel()
        comparing = false
        wipe = 1f
        restarting = false
        applied = null
        status = ""
    }
}

/** 关闭视频轨后等多久再打开 */
private const val RESTART_GAP_MS = 150L

/** 重新打开视频轨后，忽略轨道回调的时长 */
private const val RESTART_SETTLE_MS = 500L

/** 首次出现增强画面时，擦除线从左扫到右的时长 */
private const val REVEAL_MS = 900L

/** 按住 / 松开对比时，擦除线的移动时长 */
private const val COMPARE_MS = 380L
