/**
 * 内置播放器的画质增强：把视频帧画到叠在 <video> 上的 WebGL 画布，分两步处理（FSR 1.0）：
 * 先用 EASU 把片源放大到画布尺寸（片源本来就够大时只做双线性缩放），再用 RCAS 锐化。
 * 任何一步失败（跨域视频不能当纹理、WebGL 不可用、上下文丢失）都撤掉画布，回到原生画面。
 */
import {
  COPY_FRAGMENT,
  type EnhanceLevel,
  FSR_EASU_FRAGMENT,
  FSR_RCAS_FRAGMENT,
  rcasStrength,
} from '../../../../../shared/playback/enhance'

/** 第一步：读视频纹理（视频首行在上，所以 y 翻转） */
const VERTEX_VIDEO = `attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

/** 第二步：读第一步画出来的纹理（已是上下正确的朝向） */
const VERTEX_IMAGE = `attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

/** 首次出现增强画面时，擦除线从左扫到右的时长 */
const REVEAL_MS = 900

/** 按住 / 松开对比时，擦除线的移动时长 */
const COMPARE_MS = 380

export interface WebEnhancer {
  setLevel: (level: EnhanceLevel) => void
  /** 按住看原画：擦除线向左扫过；松开扫回右边 */
  setCompare: (on: boolean) => void
  dispose: () => void
}

interface Options {
  state?: (state: string) => void
  level: EnhanceLevel
  /** 片源确认为 SDR 时才增强；HDR 与未知色彩保持原生 */
  sdr: () => boolean
  /** 增强画面是否正在显示（对比按钮据此出现） */
  onActive?: (active: boolean) => void
}

function link(
  gl: WebGLRenderingContext,
  vertex: string,
  fragment: string
): WebGLProgram | null {
  const build = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
  }
  const vs = build(gl.VERTEX_SHADER, vertex)
  const fs = build(gl.FRAGMENT_SHADER, fragment)
  const program = gl.createProgram()
  if (!vs || !fs || !program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.bindAttribLocation(program, 0, 'aPos')
  gl.linkProgram(program)
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null
}

/** 给 video 挂上增强画布；返回 null 表示当前环境不支持。 */
export function attachWebEnhancer(
  video: HTMLVideoElement,
  options: Options
): WebEnhancer | null {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: false,
  })
  if (!gl) {
    options.state?.(options.level === 'off' ? '' : '不支持')
    return null
  }
  let level = options.level
  let programs: {
    easu: WebGLProgram
    copy: WebGLProgram
    rcas: WebGLProgram
  } | null = null
  let target: {
    fbo: WebGLFramebuffer
    tex: WebGLTexture
    w: number
    h: number
  } | null = null
  let alive = true
  let showing = false
  let raf = 0
  let timer = 0
  let wipe = 0
  let comparing = false
  let wipeAnim = 0
  let revealed = false

  canvas.style.cssText =
    'display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none'
  video.insertAdjacentElement('afterend', canvas)

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  )
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  const setupTexture = (unit: number): WebGLTexture | null => {
    const tex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    for (const [key, value] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, key, value)
    return tex
  }
  setupTexture(0)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

  /** 第一步的输出贴图（和画布同尺寸），尺寸变了就重建 */
  const ensureTarget = (w: number, h: number): boolean => {
    if (target && target.w === w && target.h === h) return true
    if (target) {
      gl.deleteFramebuffer(target.fbo)
      gl.deleteTexture(target.tex)
    }
    const tex = setupTexture(1)
    const fbo = gl.createFramebuffer()
    if (!tex || !fbo) return false
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    )
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0
    )
    const ok =
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    target = ok ? { fbo, tex, w, h } : null
    return ok
  }

  const setShown = (on: boolean): void => {
    if (on === showing) return
    showing = on
    video.style.visibility = on ? 'hidden' : ''
    canvas.style.display = on ? '' : 'none'
    options.onActive?.(on)
    if (!on) {
      revealed = false
      wipe = 0
    }
    if (on && !revealed) {
      revealed = true
      animateWipe(1, REVEAL_MS)
    }
  }

  const fail = (reason = '处理失败'): void => {
    dispose()
    options.state?.(level === 'off' ? '' : reason)
  }

  const draw = (): void => {
    const ready = video.readyState >= 2 && video.videoWidth > 0
    if (level === 'off' || !options.sdr() || !ready) {
      setShown(false)
      options.state?.(
        level === 'off' ? '' : !options.sdr() ? '已旁路' : '等待画面'
      )
      return
    }
    const rect = video.getBoundingClientRect()
    const scale = Math.min(
      rect.width / video.videoWidth,
      rect.height / video.videoHeight
    )
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(video.videoWidth * scale * dpr))
    const h = Math.max(1, Math.round(video.videoHeight * scale * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    try {
      if (!programs) {
        const easu = link(gl, VERTEX_VIDEO, FSR_EASU_FRAGMENT)
        const copy = link(gl, VERTEX_VIDEO, COPY_FRAGMENT)
        const rcas = link(gl, VERTEX_IMAGE, FSR_RCAS_FRAGMENT)
        if (!easu || !copy || !rcas) return fail()
        programs = { easu, copy, rcas }
      }
      if (!ensureTarget(w, h)) return fail()
      const src = { w: video.videoWidth, h: video.videoHeight }
      // 第一步：片源比画布小就 EASU 放大，否则双线性缩放
      gl.activeTexture(gl.TEXTURE0)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target!.fbo)
      gl.viewport(0, 0, w, h)
      const upscale = w > src.w || h > src.h
      const first = upscale ? programs.easu : programs.copy
      gl.useProgram(first)
      gl.uniform1i(gl.getUniformLocation(first, 'uVideo'), 0)
      if (upscale) {
        gl.uniform2f(gl.getUniformLocation(first, 'uSrc'), src.w, src.h)
        gl.uniform2f(gl.getUniformLocation(first, 'uDst'), w, h)
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      // 第二步：RCAS 锐化，画到画布上
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.useProgram(programs.rcas)
      gl.uniform1i(gl.getUniformLocation(programs.rcas, 'uImg'), 1)
      gl.uniform2f(gl.getUniformLocation(programs.rcas, 'uTexel'), 1 / w, 1 / h)
      gl.uniform1f(
        gl.getUniformLocation(programs.rcas, 'uStrength'),
        rcasStrength(level)
      )
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, target!.tex)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      if (gl.getError() !== gl.NO_ERROR) return fail()
    } catch (error) {
      // 第三方站点的直链视频是跨域数据，浏览器不允许读帧：这是片源的限制，不是处理出错
      return fail(
        error instanceof DOMException && error.name === 'SecurityError'
          ? '不支持'
          : '处理失败'
      )
    }
    setShown(true)
    options.state?.(comparing ? '原画' : 'FSR')
  }

  /** 擦除线从当前位置动到 to；暂停时没有新帧，每个动画帧自己补画 */
  const animateWipe = (to: number, ms: number): void => {
    cancelAnimationFrame(wipeAnim)
    const from = wipe
    const start = performance.now()
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / ms)
      wipe = from + (to - from) * (1 - (1 - t) ** 3)
      if (alive) draw()
      if (t < 1 && alive) wipeAnim = requestAnimationFrame(step)
    }
    wipeAnim = requestAnimationFrame(step)
  }

  const loop = (): void => {
    if (!alive) return
    draw()
    if (!alive) return
    if (video.requestVideoFrameCallback) {
      timer = video.requestVideoFrameCallback(loop)
    } else {
      raf = requestAnimationFrame(loop)
    }
  }

  // 暂停、拖动进度或窗口缩放时没有新帧回调，主动补画一次
  const redraw = (): void => {
    if (alive) draw()
  }
  const events = ['seeked', 'loadeddata', 'pause', 'emptied']
  for (const name of events) video.addEventListener(name, redraw)
  const observer = new ResizeObserver(redraw)
  observer.observe(video)
  canvas.addEventListener('webglcontextlost', () => fail())
  loop()

  function dispose(): void {
    if (!alive) return
    alive = false
    cancelAnimationFrame(raf)
    cancelAnimationFrame(wipeAnim)
    options.onActive?.(false)
    if (timer && video.cancelVideoFrameCallback)
      video.cancelVideoFrameCallback(timer)
    for (const name of events) video.removeEventListener(name, redraw)
    observer.disconnect()
    video.style.visibility = ''
    canvas.remove()
  }

  return {
    setCompare: on => {
      if (!showing) return
      comparing = on
      options.state?.(on ? '原画' : 'FSR')
      animateWipe(on ? 0 : 1, COMPARE_MS)
    },
    setLevel: next => {
      if (next === level) return
      level = next
      redraw()
    },
    dispose,
  }
}
