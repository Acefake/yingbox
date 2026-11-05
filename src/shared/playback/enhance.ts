/** 画质增强：档位、启用规则与 CAS 锐化着色器，桌面 mpv、网页播放器和安卓共用同一套参数。 */

export const ENHANCE_LEVELS = ['off', 'soft', 'standard', 'strong'] as const
export type EnhanceLevel = (typeof ENHANCE_LEVELS)[number]

const SHARPNESS: Record<EnhanceLevel, number> = {
  off: 0,
  soft: 0.3,
  standard: 0.5,
  strong: 0.8,
}

/** CAS 锐化强度 0-1。 */
export function enhanceSharpness(level: EnhanceLevel): number {
  return SHARPNESS[level]
}

interface Size {
  w: number
  h: number
}

/** 只对确认的常规 SDR 启用；HDR、杜比视界、广色域保持原生路径。 */
export function shouldEnhance(input: {
  level: EnhanceLevel
  sdr: boolean
  source: Size | null
  display: Size | null
}): boolean {
  if (input.level === 'off' || !input.sdr) return false
  const { source, display } = input
  return Boolean(
    source && display && source.w > 0 && source.h > 0 && display.w > 0
  )
}

/**
 * AMD CAS（MIT）对比度自适应锐化的核心，tap(x, y) 取相对当前像素的邻点。
 * 放大时邻点间距是输出像素，等价于先双线性放大再锐化。
 */
function casBody(sharp: number): string {
  return `
  vec3 a = tap(-1.0, -1.0), b = tap(0.0, -1.0), c = tap(1.0, -1.0);
  vec3 d = tap(-1.0, 0.0), e = tap(0.0, 0.0), f = tap(1.0, 0.0);
  vec3 g = tap(-1.0, 1.0), h = tap(0.0, 1.0), i = tap(1.0, 1.0);
  vec3 mn = min(min(min(d, e), min(f, b)), h);
  vec3 mn2 = min(min(mn, min(a, c)), min(g, i));
  mn += mn2;
  vec3 mx = max(max(max(d, e), max(f, b)), h);
  vec3 mx2 = max(max(mx, max(a, c)), max(g, i));
  mx += mx2;
  vec3 amp = clamp(min(mn, 2.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0);
  amp = sqrt(amp);
  vec3 w = amp * (-1.0 / mix(8.0, 5.0, ${sharp.toFixed(3)}));
  vec3 result = clamp((b + d + f + h) * w + e, 0.0, 1.0) / (1.0 + 4.0 * w);`
}

/** mpv 用户着色器：在显示分辨率的 OUTPUT 阶段锐化。 */
export function casMpvShader(level: EnhanceLevel): string {
  return `//!HOOK OUTPUT
//!BIND HOOKED
//!DESC yingbox CAS ${level}

vec3 tap(float x, float y) {
  return HOOKED_texOff(vec2(x, y)).rgb;
}

vec4 hook() {${casBody(SHARPNESS[level])}
  return vec4(result, HOOKED_texOff(vec2(0.0)).a);
}
`
}

/** FSR RCAS 锐化强度（stops，0 最锐，越大越柔）；各档位对应 off 之外的三档。 */
const RCAS_STOPS: Record<EnhanceLevel, number> = {
  off: 2,
  soft: 0.8,
  standard: 0.3,
  strong: 0,
}

/** RCAS 的 con 常数：exp2(-stops)。 */
export function rcasStrength(level: EnhanceLevel): number {
  return 2 ** -RCAS_STOPS[level]
}

/**
 * AMD FidelityFX Super Resolution 1.0 的 EASU（边缘自适应放大），按官方 ffx_fsr1.h 的 FsrEasuF 移植到 WebGL1。
 * Copyright (c) 2021 Advanced Micro Devices, Inc.，MIT 许可证（全文见 licenses/ 下的第三方许可）。
 * 12 个邻点按源像素整数坐标取，uSrc / uDst 是源与输出的像素尺寸，vUv 为 0-1 坐标。
 */
export const FSR_EASU_FRAGMENT = `precision highp float;
uniform sampler2D uVideo;
uniform vec2 uSrc;
uniform vec2 uDst;
varying vec2 vUv;

vec3 ld(vec2 fp, float x, float y) {
  return texture2D(uVideo, (fp + vec2(x, y) + 0.5) / uSrc).rgb;
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
  gl_FragColor = vec4(min(max4, max(min4, aC * rcp(aW))), 1.0);
}
`

/** FSR RCAS（鲁棒对比度自适应锐化），按官方 FsrRcasF 移植，保护了分母为零的情况。同样 MIT 许可。 */
export const FSR_RCAS_FRAGMENT = `precision highp float;
uniform sampler2D uImg;
uniform vec2 uTexel;
uniform float uStrength;
varying vec2 vUv;

vec3 ld(float x, float y) { return texture2D(uImg, vUv + vec2(x, y) * uTexel).rgb; }
float luma2(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }

void main() {
  vec3 b = ld(0.0, -1.0), d = ld(-1.0, 0.0), e = ld(0.0, 0.0), f = ld(1.0, 0.0), h = ld(0.0, 1.0);
  vec3 mn4 = min(min(min(b, d), f), h);
  vec3 mx4 = max(max(max(b, d), f), h);
  vec3 hitMin = min(mn4, e) / max(4.0 * mx4, 1e-4);
  vec3 hitMax = (1.0 - max(mx4, e)) / min(4.0 * mn4 - 4.0, -1e-4);
  vec3 lobeV = max(-hitMin, hitMax);
  float lobe = max(-0.22, min(max(max(lobeV.r, lobeV.g), lobeV.b), 0.0)) * uStrength;
  float rcpL = 1.0 / (4.0 * lobe + 1.0);
  gl_FragColor = vec4((lobe * b + lobe * d + lobe * h + lobe * f + e) * rcpL, 1.0);
}
`

/** 把一张贴图原样（双线性）画到输出尺寸，片源不需要放大时代替 EASU。 */
export const COPY_FRAGMENT = `precision highp float;
uniform sampler2D uVideo;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(uVideo, vUv).rgb, 1.0); }
`

/** 色彩元数据确认为常规 SDR（BT.709 原色 + SDR 传输曲线）。 */
export function isSdrColor(gamma: unknown, primaries: unknown): boolean {
  const g = typeof gamma === 'string' ? gamma.toLowerCase() : ''
  const p = typeof primaries === 'string' ? primaries.toLowerCase() : ''
  return (
    ['bt.1886', 'srgb', 'gamma2.2', 'gamma2.4', 'bt.709'].includes(g) &&
    ['bt.709', 'bt.601-525', 'bt.601-625'].includes(p)
  )
}
