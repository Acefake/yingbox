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
 * AMD FSR 1.0 的 EASU 边缘自适应放大：把画面放大到高度 [targetHeight]（宽度按比例，取偶数），之后接 [RcasEffect] 锐化。
 * 着色器按官方 ffx_fsr1.h（MIT，Copyright (c) 2021 Advanced Micro Devices, Inc.）移植，与桌面端、网页端同一算法。
 */
@OptIn(UnstableApi::class)
class EasuEffect(
    private val targetHeight: Int,
    /** 擦除线位置 0–1：线左边是增强后的画面，右边是原画；1 为全部增强 */
    private val wipe: () -> Float = { 1f },
) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
        try {
            EasuShaderProgram(useHdr, targetHeight, wipe)
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e)
        }
}

@OptIn(UnstableApi::class)
private class EasuShaderProgram(
    useHdr: Boolean,
    private val targetHeight: Int,
    private val wipe: () -> Float,
) : BaseGlShaderProgram(useHdr, 1) {
    private val program = GlProgram(VERTEX, FRAGMENT)
    private var srcWidth = 1
    private var srcHeight = 1

    override fun configure(inputWidth: Int, inputHeight: Int): Size {
        srcWidth = inputWidth
        srcHeight = inputHeight
        val (w, h) = easuOutputSize(inputWidth, inputHeight, targetHeight)
        return Size(w, h)
    }

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        try {
            program.use()
            program.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
            program.setFloatsUniform("uSrc", floatArrayOf(srcWidth.toFloat(), srcHeight.toFloat()))
            program.setFloatUniform("uWipe", wipe())
            program.setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), 4)
            program.bindAttributesAndUniforms()
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GlUtil.checkGlError()
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
uniform vec2 uSrc;
uniform float uWipe;
varying vec2 vUv;

vec3 ld(vec2 fp, float x, float y) {
  return texture2D(uTexSampler, (fp + vec2(x, y) + 0.5) / uSrc).rgb;
}
float luma2(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }
float rcp(float x) { return 1.0 / max(x, 1e-6); }

void tap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c) {
  vec2 v = vec2(off.x * dir.x + off.y * dir.y, off.x * -dir.y + off.y * dir.x);
  v *= len;
  float d2 = min(v.x * v.x + v.y * v.y, clp);
  float wB = 2.0 / 5.0 * d2 - 1.0;
  float wA = lob * d2 - 1.0;
  wB *= wB;
  wA *= wA;
  wB = 25.0 / 16.0 * wB - (25.0 / 16.0 - 1.0);
  float w = wB * wA;
  aC += c * w;
  aW += w;
}

void setDir(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE) {
  float lenX = rcp(max(abs(lD - lC), abs(lC - lB)));
  float dirX = lD - lB;
  dir.x += dirX * w;
  lenX = clamp(abs(dirX) * lenX, 0.0, 1.0);
  len += lenX * lenX * w;
  float lenY = rcp(max(abs(lE - lC), abs(lC - lA)));
  float dirY = lE - lA;
  dir.y += dirY * w;
  lenY = clamp(abs(dirY) * lenY, 0.0, 1.0);
  len += lenY * lenY * w;
}

void main() {
  vec2 pp = vUv * uSrc - 0.5;
  vec2 fp = floor(pp);
  pp -= fp;
  vec3 b = ld(fp, 0.0, -1.0), c = ld(fp, 1.0, -1.0);
  vec3 e = ld(fp, -1.0, 0.0), f = ld(fp, 0.0, 0.0), g = ld(fp, 1.0, 0.0), h = ld(fp, 2.0, 0.0);
  vec3 i = ld(fp, -1.0, 1.0), j = ld(fp, 0.0, 1.0), k = ld(fp, 1.0, 1.0), l = ld(fp, 2.0, 1.0);
  vec3 n = ld(fp, 0.0, 2.0), o = ld(fp, 1.0, 2.0);
  float bL = luma2(b), cL = luma2(c), eL = luma2(e), fL = luma2(f), gL = luma2(g), hL = luma2(h);
  float iL = luma2(i), jL = luma2(j), kL = luma2(k), lL = luma2(l), nL = luma2(n), oL = luma2(o);

  vec2 dir = vec2(0.0);
  float len = 0.0;
  setDir(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
  setDir(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
  setDir(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
  setDir(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);

  float dirR = dir.x * dir.x + dir.y * dir.y;
  bool zro = dirR < 1.0 / 32768.0;
  dirR = zro ? 1.0 : inversesqrt(dirR);
  dir.x = zro ? 1.0 : dir.x;
  dir *= dirR;
  len = len * 0.5;
  len *= len;
  float stretch = (dir.x * dir.x + dir.y * dir.y) * rcp(max(abs(dir.x), abs(dir.y)));
  vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  float lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
  float clp = rcp(lob);

  vec3 min4 = min(min(min(f, g), j), k);
  vec3 max4 = max(max(max(f, g), j), k);
  vec3 aC = vec3(0.0);
  float aW = 0.0;
  tap(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, b);
  tap(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, c);
  tap(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, i);
  tap(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, j);
  tap(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, f);
  tap(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, e);
  tap(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, k);
  tap(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, l);
  tap(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, h);
  tap(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, g);
  tap(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, o);
  tap(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, n);
  vec3 easu = min(max4, max(min4, aC * rcp(aW)));
  // 擦除线左边是 EASU，右边是原画（双线性放大），用来对比
  gl_FragColor = vec4(vUv.x < uWipe ? easu : texture2D(uTexSampler, vUv).rgb, 1.0);
}"""
    }
}
