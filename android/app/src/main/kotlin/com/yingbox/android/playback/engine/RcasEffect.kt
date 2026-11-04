package com.yingbox.android.playback.engine

import android.content.Context
import android.opengl.GLES20
import androidx.annotation.OptIn
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram

/**
 * AMD FSR 1.0 的 RCAS 鲁棒对比度自适应锐化（MIT，Copyright (c) 2021 Advanced Micro Devices, Inc.），
 * 与桌面端、网页端同一算法；片源需要放大时接在 [EasuEffect] 之后。
 */
@OptIn(UnstableApi::class)
class RcasEffect(
    private val strength: Float,
    private val onRendered: () -> Unit = {},
    /** 擦除线位置 0–1：线左边是增强后的画面，右边是原画；1 为全部增强 */
    private val wipe: () -> Float = { 1f },
) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
        try {
            RcasShaderProgram(useHdr, strength, onRendered, wipe)
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e)
        }
}

@OptIn(UnstableApi::class)
private class RcasShaderProgram(
    useHdr: Boolean,
    private val strength: Float,
    private val onRendered: () -> Unit,
    private val wipe: () -> Float,
) :
    BaseGlShaderProgram(useHdr, 1) {
    private val program = GlProgram(VERTEX, FRAGMENT)
    private var width = 1
    private var height = 1
    private var reported = false

    override fun configure(inputWidth: Int, inputHeight: Int): Size {
        width = inputWidth
        height = inputHeight
        return Size(inputWidth, inputHeight)
    }

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        try {
            program.use()
            program.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
            program.setFloatUniform("uTexelX", 1f / width)
            program.setFloatUniform("uTexelY", 1f / height)
            program.setFloatUniform("uStrength", strength)
            program.setFloatUniform("uWipe", wipe())
            program.setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), 4)
            program.bindAttributesAndUniforms()
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GlUtil.checkGlError()
            if (!reported) { reported = true; onRendered() }
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e)
        }
    }

    override fun release() {
        super.release()
        try {
            program.delete()
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e)
        }
    }

    private companion object {
        const val VERTEX = """
attribute vec4 aFramePosition;
varying vec2 vUv;
void main() {
  gl_Position = aFramePosition;
  vUv = aFramePosition.xy * 0.5 + 0.5;
}"""

        const val FRAGMENT = """
precision highp float;
uniform sampler2D uTexSampler;
uniform float uTexelX;
uniform float uTexelY;
uniform float uStrength;
uniform float uWipe;
varying vec2 vUv;
vec3 ld(float x, float y) {
  return texture2D(uTexSampler, vUv + vec2(x * uTexelX, y * uTexelY)).rgb;
}
void main() {
  vec3 b = ld(0.0, -1.0), d = ld(-1.0, 0.0), e = ld(0.0, 0.0), f = ld(1.0, 0.0), h = ld(0.0, 1.0);
  vec3 mn4 = min(min(min(b, d), f), h);
  vec3 mx4 = max(max(max(b, d), f), h);
  vec3 hitMin = min(mn4, e) / max(4.0 * mx4, 1e-4);
  vec3 hitMax = (1.0 - max(mx4, e)) / min(4.0 * mn4 - 4.0, -1e-4);
  vec3 lobeV = max(-hitMin, hitMax);
  float lobe = max(-(0.25 - 1.0 / 16.0), min(max(max(lobeV.r, lobeV.g), lobeV.b), 0.0)) * uStrength;
  float rcpL = 1.0 / (4.0 * lobe + 1.0);
  vec3 result = (lobe * b + lobe * d + lobe * h + lobe * f + e) * rcpL;
  vec3 color = vUv.x < uWipe ? result : e;
  // 擦除线：只在动画过程中出现，两端不显示
  float line = (1.0 - smoothstep(0.0, 0.004, abs(vUv.x - uWipe))) * step(0.001, uWipe) * step(uWipe, 0.999);
  gl_FragColor = vec4(mix(color, vec3(1.0), line * 0.85), 1.0);
}"""
    }
}
