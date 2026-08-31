import { useEffect, useRef, useState } from 'react'
import { games, type Game } from './data/games'
import { MgbaCoreAdapter } from './emulator/mgbaCoreAdapter'
import type { CheatRule, EmulatorSpeed, EmulatorStatus, GbaButton, SaveStateSlot } from './emulator/types'

type Route = { page: 'home' } | { page: 'play'; game: Game }

type KeyboardAction = GbaButton | 'quickSave' | 'quickLoad' | 'speedToggle' | 'cleanModeToggle'
type KeyboardBindings = Record<KeyboardAction, string>
const keyboardBindingsKey = 'gba-center:keyboard-bindings'
const controllerActions: GbaButton[] = ['up', 'down', 'left', 'right', 'b', 'a', 'l', 'r', 'select', 'start']
const bindingActions: KeyboardAction[] = [...controllerActions, 'quickSave', 'quickLoad', 'speedToggle', 'cleanModeToggle']
const defaultKeyboardBindings: KeyboardBindings = {
  up: 'w', down: 's', left: 'a', right: 'd', b: 'q', a: 'e', l: 'z', r: 'c', select: ' ', start: 'Enter',
  quickSave: 'F5', quickLoad: 'F8', speedToggle: 'x', cleanModeToggle: 'F9',
}
const keyboardLabels: Record<KeyboardAction, string> = {
  up: '上', down: '下', left: '左', right: '右', b: 'B 键', a: 'A 键', l: 'L 键', r: 'R 键', select: '选择', start: '开始',
  quickSave: '快速存档', quickLoad: '快速读档', speedToggle: '倍速切换', cleanModeToggle: '纯画面模式',
}

function normalizeKeyboardKey(key: string) { return key.length === 1 ? key.toLowerCase() : key }
function displayKeyboardKey(key: string) {
  return ({ ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' } as Record<string, string>)[key] ?? (key.length === 1 ? key.toUpperCase() : key)
}

const nativeSwitchProps = { switch: '' } as React.InputHTMLAttributes<HTMLInputElement>
function loadKeyboardBindings(): KeyboardBindings {
  try {
    const saved = JSON.parse(localStorage.getItem(keyboardBindingsKey) ?? '{}') as Partial<KeyboardBindings>
    const next = { ...defaultKeyboardBindings }
    const used = new Set<string>()
    for (const action of bindingActions) {
      const savedKey = typeof saved[action] === 'string' ? normalizeKeyboardKey(saved[action]!) : undefined
      const requested = action === 'l' && savedKey === 'u'
        ? 'z'
        : action === 'r' && savedKey === 'o'
          ? 'c'
          : savedKey ?? next[action]
      next[action] = used.has(requested) ? defaultKeyboardBindings[action] : requested
      used.add(next[action])
    }
    localStorage.setItem(keyboardBindingsKey, JSON.stringify(next))
    return next
  } catch { return { ...defaultKeyboardBindings } }
}

function ConsoleButton({
  button,
  label,
  className = '',
  disabled,
  onInput,
}: {
  button: GbaButton
  label: string
  className?: string
  disabled?: boolean
  onInput: (button: GbaButton, pressed: boolean) => void
}) {
  const element = useRef<HTMLLabelElement>(null)
  const pointerId = useRef<number | null>(null)
  const pressedRef = useRef(false)
  const inputHandler = useRef(onInput)
  const [pressed, setPressed] = useState(false)
  inputHandler.current = onInput

  const updatePressed = (next: boolean) => {
    pressedRef.current = next
    setPressed(next)
  }
  const release = (releasedPointer?: number) => {
    if (releasedPointer !== undefined && pointerId.current !== releasedPointer) return
    const capturedPointer = pointerId.current
    if (capturedPointer === null && !pressedRef.current) return
    pointerId.current = null
    updatePressed(false)
    inputHandler.current(button, false)
    if (capturedPointer !== null && element.current?.hasPointerCapture(capturedPointer)) {
      element.current.releasePointerCapture(capturedPointer)
    }
    element.current?.querySelector('input')?.blur()
    element.current?.blur()
  }

  useEffect(() => {
    const releasePointer = (event: PointerEvent) => release(event.pointerId)
    const releaseAll = () => release()
    window.addEventListener('pointerup', releasePointer, true)
    window.addEventListener('pointercancel', releasePointer, true)
    window.addEventListener('blur', releaseAll)
    window.addEventListener('pagehide', releaseAll)
    document.addEventListener('visibilitychange', releaseAll)
    return () => {
      window.removeEventListener('pointerup', releasePointer, true)
      window.removeEventListener('pointercancel', releasePointer, true)
      window.removeEventListener('blur', releaseAll)
      window.removeEventListener('pagehide', releaseAll)
      document.removeEventListener('visibilitychange', releaseAll)
      if (pressedRef.current) inputHandler.current(button, false)
    }
  }, [button])

  return (
    <label
      ref={element}
      className={`console-button ${className}${pressed ? ' is-pressed' : ''}${disabled ? ' is-disabled' : ''}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled}
      aria-pressed={pressed}
      onPointerDown={event => {
        if (disabled || event.button !== 0 || pointerId.current !== null) return
        pointerId.current = event.pointerId
        updatePressed(true)
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Global release listeners cover older Safari. */ }
        triggerHapticFeedback()
        inputHandler.current(button, true)
      }}
      onPointerUp={event => release(event.pointerId)}
      onPointerCancel={event => release(event.pointerId)}
      onLostPointerCapture={() => release()}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        if (disabled || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        updatePressed(true)
        triggerHapticFeedback()
        inputHandler.current(button, true)
      }}
      onKeyUp={event => {
        if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        updatePressed(false)
        inputHandler.current(button, false)
      }}
    >
      <input {...nativeSwitchProps} className="ios-haptic-switch" type="checkbox" disabled={disabled} tabIndex={-1} aria-hidden="true" />
      <span className="control-button-text" aria-hidden="true">{label}</span>
    </label>
  )
}

type Direction = Extract<GbaButton, 'up' | 'down' | 'left' | 'right'>

function DirectionalPad({ disabled, onInput }: { disabled?: boolean; onInput: (button: GbaButton, pressed: boolean) => void }) {
  const element = useRef<HTMLDivElement>(null)
  const pointerId = useRef<number | null>(null)
  const direction = useRef<Direction | null>(null)
  const [pressed, setPressed] = useState<Direction | null>(null)

  const setDirection = (next: Direction | null) => {
    if (direction.current === next) return
    if (direction.current) onInput(direction.current, false)
    direction.current = next
    setPressed(next)
    if (next) {
      triggerHapticFeedback()
      onInput(next, true)
    }
  }

  const updateDirection = (clientX: number, clientY: number) => {
    const rect = element.current?.getBoundingClientRect()
    if (!rect) return
    const x = (clientX - rect.left - rect.width / 2) / (rect.width / 2)
    const y = (clientY - rect.top - rect.height / 2) / (rect.height / 2)
    if (Math.hypot(x, y) < .18) return setDirection(null)
    setDirection(Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up'))
  }

  const release = (releasedPointer?: number) => {
    if (releasedPointer !== undefined && pointerId.current !== releasedPointer) return
    const capturedPointer = pointerId.current
    pointerId.current = null
    setDirection(null)
    if (capturedPointer !== null && element.current?.hasPointerCapture(capturedPointer)) {
      element.current.releasePointerCapture(capturedPointer)
    }
    element.current?.querySelector('input')?.blur()
  }

  useEffect(() => {
    const releasePointer = (event: PointerEvent) => release(event.pointerId)
    const releaseAll = () => release()
    window.addEventListener('pointerup', releasePointer, true)
    window.addEventListener('pointercancel', releasePointer, true)
    window.addEventListener('blur', releaseAll)
    window.addEventListener('pagehide', releaseAll)
    document.addEventListener('visibilitychange', releaseAll)
    return () => {
      window.removeEventListener('pointerup', releasePointer, true)
      window.removeEventListener('pointercancel', releasePointer, true)
      window.removeEventListener('blur', releaseAll)
      window.removeEventListener('pagehide', releaseAll)
      document.removeEventListener('visibilitychange', releaseAll)
      if (direction.current) onInput(direction.current, false)
    }
  }, [])

  return (
    <div
      ref={element}
      className={`gba-dpad${pressed ? ` is-${pressed}` : ''}${disabled ? ' is-disabled' : ''}`}
      role="group"
      aria-label="方向键"
      onPointerDown={event => {
        if (disabled || event.button !== 0 || pointerId.current !== null) return
        event.preventDefault()
        pointerId.current = event.pointerId
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Global release listeners cover older Safari. */ }
        updateDirection(event.clientX, event.clientY)
      }}
      onPointerMove={event => {
        if (pointerId.current !== event.pointerId) return
        event.preventDefault()
        updateDirection(event.clientX, event.clientY)
      }}
      onPointerUp={event => release(event.pointerId)}
      onPointerCancel={event => release(event.pointerId)}
      onLostPointerCapture={() => release()}
      onContextMenu={event => event.preventDefault()}
    >
      <input {...nativeSwitchProps} className="ios-haptic-switch dpad-haptic-switch" type="checkbox" disabled={disabled} tabIndex={-1} aria-hidden="true" />
      <span className="dpad-bar dpad-bar-horizontal" />
      <span className="dpad-bar dpad-bar-vertical" />
      <i className="dpad-center" />
    </div>
  )
}

function CartridgeArtwork({ game, large = false }: { game: Game; large?: boolean }) {
  return (
    <div className={`cartridge-art${large ? ' is-large' : ''}`} style={{ '--game-color': game.color } as React.CSSProperties}>
      <div className="cartridge-top"><span /><span /><span /><span /><span /></div>
      <div className="cartridge-label">
        {game.cover ? <img src={game.cover} alt="" /> : (
          <div className="fallback-cover">
            <span>GAME BOY ADVANCE</span>
            <strong>{game.subtitle}</strong>
            <i>GBA</i>
          </div>
        )}
      </div>
      <span className="cartridge-mark">GAME BOY ADVANCE</span>
    </div>
  )
}

function HomeShaderBackdrop({ cover, accent }: { cover?: string; accent: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' })
    if (!gl) return

    const vertexSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = a_position * .5 + .5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `
    const fragmentSource = `
      precision mediump float;
      varying vec2 v_uv;
      uniform vec2 u_resolution;
      uniform vec2 u_textureSize;
      uniform float u_time;
      uniform float u_hasTexture;
      uniform sampler2D u_cover;
      uniform vec3 u_accent;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      vec2 coverUv(vec2 uv) {
        float screenAspect = u_resolution.x / max(u_resolution.y, 1.0);
        float imageAspect = u_textureSize.x / max(u_textureSize.y, 1.0);
        vec2 scale = imageAspect > screenAspect
          ? vec2(screenAspect / imageAspect, 1.0)
          : vec2(1.0, imageAspect / screenAspect);
        return (uv - .5) * scale + .5;
      }

      void main() {
        vec2 uv = v_uv;
        vec2 centered = uv - .5;
        float t = u_time * .32;
        float wave = sin(uv.y * 9.0 + t * 2.1) * .012
          + sin(uv.x * 13.0 - t * 1.7) * .008;
        vec2 texUv = coverUv(uv + vec2(wave, cos(uv.x * 8.0 + t) * .009));
        vec3 coverColor = vec3(.08, .06, .16);

        if (u_hasTexture > .5) {
          vec2 aberration = centered * .008;
          float red = texture2D(u_cover, texUv + aberration).r;
          float green = texture2D(u_cover, texUv).g;
          float blue = texture2D(u_cover, texUv - aberration).b;
          vec3 soft = texture2D(u_cover, texUv + vec2(.008, 0.0)).rgb
            + texture2D(u_cover, texUv - vec2(.008, 0.0)).rgb
            + texture2D(u_cover, texUv + vec2(0.0, .008)).rgb
            + texture2D(u_cover, texUv - vec2(0.0, .008)).rgb;
          coverColor = mix(vec3(red, green, blue), soft * .25, .45);
        }

        float luminance = dot(coverColor, vec3(.299, .587, .114));
        vec3 graded = mix(coverColor, vec3(luminance) * u_accent, .48);
        float auroraA = .5 + .5 * sin((uv.x * 1.35 + uv.y) * 7.0 - t * 1.8);
        float auroraB = .5 + .5 * sin((uv.x - uv.y * .75) * 9.0 + t * 1.25);
        float beam = pow(auroraA, 7.0) * .18 + pow(auroraB, 10.0) * .12;
        vec3 color = graded * .42 + u_accent * beam;
        color += vec3(.12, .06, .2) * (1.0 - length(centered) * .95);
        float scan = sin(gl_FragCoord.y * 1.55) * .018;
        float grain = (hash(gl_FragCoord.xy + floor(u_time * 24.0)) - .5) * .035;
        float vignette = smoothstep(.82, .18, length(centered * vec2(1.0, .82)));
        color = (color + scan + grain) * (.36 + vignette * .64);
        gl_FragColor = vec4(color, .96);
      }
    `

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('[WebGL] Shader 编译失败。', gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
      }
      return shader
    }
    const vertexShader = compile(gl.VERTEX_SHADER, vertexSource)
    const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource)
    if (!vertexShader || !fragmentShader) return
    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[WebGL] Shader 链接失败。', gl.getProgramInfoLog(program))
      return
    }
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    const texture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 16, 42, 255]))

    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution')
    const textureSizeLocation = gl.getUniformLocation(program, 'u_textureSize')
    const timeLocation = gl.getUniformLocation(program, 'u_time')
    const hasTextureLocation = gl.getUniformLocation(program, 'u_hasTexture')
    const accentLocation = gl.getUniformLocation(program, 'u_accent')
    gl.uniform1i(gl.getUniformLocation(program, 'u_cover'), 0)
    gl.uniform2f(textureSizeLocation, 1, 1)
    gl.uniform1f(hasTextureLocation, 0)

    const hex = accent.replace('#', '')
    const normalizedHex = hex.length === 3 ? [...hex].map(value => value + value).join('') : hex.padEnd(6, '8').slice(0, 6)
    const accentRgb = [0, 2, 4].map(index => Number.parseInt(normalizedHex.slice(index, index + 2), 16) / 255)
    gl.uniform3f(accentLocation, accentRgb[0], accentRgb[1], accentRgb[2])

    let disposed = false
    let frame = 0
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const startedAt = performance.now()
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      gl.viewport(0, 0, width, height)
      gl.uniform2f(resolutionLocation, width, height)
    }
    const render = (now: number) => {
      if (disposed) return
      resize()
      gl.uniform1f(timeLocation, reducedMotion ? 0 : (now - startedAt) / 1000)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      if (!reducedMotion && document.visibilityState === 'visible') frame = requestAnimationFrame(render)
    }
    const resumeRendering = () => {
      if (!disposed && !reducedMotion && document.visibilityState === 'visible') {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(render)
      }
    }

    const image = new Image()
    if (cover) {
      image.onload = () => {
        if (disposed) return
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
        gl.uniform2f(textureSizeLocation, image.naturalWidth, image.naturalHeight)
        gl.uniform1f(hasTextureLocation, 1)
        if (reducedMotion) frame = requestAnimationFrame(render)
      }
      image.src = cover
    }
    frame = requestAnimationFrame(render)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', resumeRendering)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', resumeRendering)
      gl.deleteTexture(texture)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
    }
  }, [cover, accent])

  return <canvas ref={canvasRef} className="gba-home-shader" aria-hidden="true" />
}

function HomePage({ openGame, openSettings }: { openGame: (game: Game) => void; openSettings: () => void }) {
  const [activeGame, setActiveGame] = useState(0)

  const moveCarousel = (direction: number) => {
    if (!games.length) return
    setActiveGame(current => (current + direction + games.length) % games.length)
  }

  useEffect(() => {
    const moveWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') moveCarousel(-1)
      if (event.key === 'ArrowRight') moveCarousel(1)
    }
    window.addEventListener('keydown', moveWithKeyboard)
    return () => window.removeEventListener('keydown', moveWithKeyboard)
  }, [])

  return (
    <main className="home-page gba-home-shell">
      <HomeShaderBackdrop cover={games[activeGame]?.cover} accent={games[activeGame]?.color ?? '#7557ee'} />
      <section className="gba-carousel" aria-label="游戏卡带">
        <button className="gba-carousel-arrow" disabled={games.length < 2} aria-label="上一款游戏" onClick={() => moveCarousel(-1)}>‹</button>
        <div className="gba-carousel-stage">
          {games.length ? games.map((game, index) => {
            let offset = index - activeGame
            if (offset > games.length / 2) offset -= games.length
            if (offset < -games.length / 2) offset += games.length
            return <button
              className={`gba-carousel-card${offset === 0 ? ' is-active' : ''}${Math.abs(offset) > 1 ? ' is-hidden' : ''}`}
              key={game.id}
              style={{ '--carousel-offset': `${offset * 300}px`, '--game-color': game.color } as React.CSSProperties}
              tabIndex={offset === 0 ? 0 : -1}
              aria-label={offset === 0 ? `游玩${game.title}` : `选择${game.title}`}
              onClick={() => offset === 0 ? openGame(game) : setActiveGame(index)}
            ><CartridgeArtwork game={game} /></button>
          }) : <div className="gba-empty-card"><span>暂无游戏</span></div>}
        </div>
        <button className="gba-carousel-arrow" disabled={games.length < 2} aria-label="下一款游戏" onClick={() => moveCarousel(1)}>›</button>
        {games[activeGame] && <div className="gba-carousel-caption">
          <strong>{games[activeGame].title}</strong>
          <span>{games[activeGame].subtitle}</span>
          <small>{activeGame + 1} / {games.length}</small>
        </div>}
      </section>

      <nav className="gba-home-actions" aria-label="主页操作">
        <button onClick={openSettings}>设置</button>
      </nav>
      {games[activeGame]?.credits?.length ? <aside className="gba-special-thanks">
        <span>本改版特别鸣谢</span>
        {games[activeGame].credits!.map(credit => <a key={credit.url} href={credit.url} target="_blank" rel="noreferrer">{credit.label}</a>)}
      </aside> : null}
    </main>
  )
}

function triggerHapticFeedback() {
  try { navigator.vibrate?.(12) } catch { /* Haptics are optional. */ }
}

async function shareBackupFile(file: File, title: string) {
  if (!navigator.canShare?.({ files: [file] })) return false
  try {
    await navigator.share({ files: [file], title })
    return true
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') throw reason
    return false
  }
}

function HoldActionButton({ icon, label, disabled, onPress, onHold }: {
  icon: string; label: string; disabled?: boolean; onPress: () => void; onHold: () => void
}) {
  const timer = useRef<number | null>(null)
  const [holding, setHolding] = useState(false)
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  useEffect(() => cancel, [])
  return <button
    type="button"
    className={holding ? 'is-holding' : ''}
    disabled={disabled}
    aria-label={`${label}，短按选择槽位，长按使用快速槽位`}
    onPointerDown={event => {
      if (disabled || event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      setHolding(true)
      timer.current = window.setTimeout(() => {
        timer.current = null
        setHolding(false)
        triggerHapticFeedback()
        onHold()
      }, 600)
    }}
    onPointerUp={event => {
      const shortPress = timer.current !== null
      cancel()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      if (shortPress) onPress()
    }}
    onPointerCancel={cancel}
    onLostPointerCapture={cancel}
    onClick={event => { if (event.detail === 0 && !disabled) onPress() }}
  ><span>{icon}</span>{holding ? '按住…' : label}</button>
}

type GameTool = 'save' | 'load' | 'cheats'
const saveSlots = [
  { slot: -2, label: 'AUTO' }, { slot: -1, label: 'QUICK' },
  ...Array.from({ length: 8 }, (_, index) => ({ slot: index, label: `SLOT ${String(index + 1).padStart(2, '0')}` })),
]
const gameSpeeds: EmulatorSpeed[] = [1, 2, 5]

function formatSaveTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp)
}

function SaveSlotCard({ slot, label, saved, busy, disabled, isSaveMode, onActivate, onDelete }: {
  slot: number; label: string; saved?: SaveStateSlot; busy: boolean; disabled: boolean; isSaveMode: boolean; onActivate: () => void; onDelete: () => void
}) {
  const holdTimer = useRef<number | null>(null)
  const suppressClick = useRef(false)
  const deleteRequested = useRef(false)
  const [showDelete, setShowDelete] = useState(false)
  const clearHold = () => { if (holdTimer.current !== null) window.clearTimeout(holdTimer.current); holdTimer.current = null }
  const requestDelete = () => {
    if (deleteRequested.current || busy) return
    deleteRequested.current = true
    setShowDelete(false)
    onDelete()
  }
  useEffect(() => clearHold, [])
  return <div className={`save-slot${saved ? ' is-filled' : ''}${slot === -2 ? ' is-auto-slot' : ''}${slot === -1 ? ' is-quick-slot' : ''}${disabled ? ' is-disabled' : ''}${showDelete ? ' is-delete-visible' : ''}`}>
    <button className="save-slot-main" type="button" disabled={disabled} onPointerDown={event => {
      if (!saved || disabled || event.button !== 0) return
      suppressClick.current = false
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null
        suppressClick.current = true
        deleteRequested.current = false
        setShowDelete(true)
        triggerHapticFeedback()
      }, 650)
    }} onPointerUp={() => {
      clearHold()
    }} onPointerCancel={event => {
      if (event.pointerType === 'touch' && holdTimer.current !== null) return
      clearHold()
    }} onPointerLeave={() => {
      if (!suppressClick.current) clearHold()
    }} onClick={event => {
      if (suppressClick.current) {
        suppressClick.current = false
        event.preventDefault()
        return
      }
      setShowDelete(false)
      onActivate()
    }} onContextMenu={event => event.preventDefault()}>
      <span className="save-slot-number">{label}</span>
      <span className="save-slot-preview">{saved?.thumbnail ? <img src={saved.thumbnail} alt="" /> : <i aria-hidden="true" />}</span>
      <span className="save-slot-time">{busy ? (isSaveMode ? '保存中…' : '处理中…') : saved ? formatSaveTime(saved.updatedAt) : '空槽位'}</span>
    </button>
    {showDelete && saved && <button className="save-slot-delete" type="button" disabled={busy} onPointerDown={event => {
      event.stopPropagation()
      requestDelete()
    }} onClick={requestDelete}>删除</button>}
  </div>
}

function GameToolsDialog({ mode, slots, busySlot, cheats, onSave, onLoad, onDelete, onExport, onImport, onAddCheat, onToggleCheat, onRemoveCheat, onClose }: {
  mode: GameTool; slots: SaveStateSlot[]; busySlot: number | null; cheats: CheatRule[];
  onSave: (slot: number) => void; onLoad: (slot: number) => void; onDelete: (slot: number) => void;
  onExport: () => void; onImport: (file: File) => void;
  onAddCheat: (code: string) => void; onToggleCheat: (id: string) => void; onRemoveCheat: (id: string) => void; onClose: () => void
}) {
  const [cheatCode, setCheatCode] = useState('')
  const importInput = useRef<HTMLInputElement>(null)
  const isSaveMode = mode === 'save'
  const title = isSaveMode ? '存档' : mode === 'load' ? '读档' : '金手指'
  return <div className="pixel-dialog-backdrop" onContextMenu={event => event.preventDefault()} onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="pixel-dialog" role="dialog" aria-modal="true" aria-labelledby="game-tool-title">
      <header className="pixel-dialog-heading"><div><span>GAME BOY ADVANCE</span><h2 id="game-tool-title">{title}</h2></div><button onClick={onClose} aria-label={`关闭${title}`}>×</button></header>
      {mode !== 'cheats' ? <div className="save-slot-grid">
        {saveSlots.map(({ slot, label }) => {
          const saved = slots.find(item => item.slot === slot)
          return <SaveSlotCard key={slot} slot={slot} label={label} saved={saved} busy={busySlot === slot} disabled={busySlot !== null || (!isSaveMode && !saved)} isSaveMode={isSaveMode} onActivate={() => isSaveMode ? onSave(slot) : onLoad(slot)} onDelete={() => onDelete(slot)} />
        })}
      </div> : <div className="pixel-cheat-panel">
        <form className="pixel-cheat-form" onSubmit={event => {
          event.preventDefault()
          const code = cheatCode.trim().toUpperCase().replace(/[\s,;]+/g, '+')
          if (!code) return
          onAddCheat(code)
          setCheatCode('')
        }}><label htmlFor="cheat-code">输入 GameShark / CodeBreaker 代码</label><div><input id="cheat-code" value={cheatCode} onChange={event => setCheatCode(event.target.value)} placeholder="例如 82000000 0001" spellCheck={false} /><button type="submit">添加</button></div></form>
        <div className="pixel-cheat-list">{cheats.length === 0 ? <div className="pixel-empty-list">尚未添加代码</div> : cheats.map(cheat => <div className="pixel-cheat-row" key={cheat.id}>
          <button type="button" className={cheat.enabled ? 'is-enabled' : ''} onClick={() => onToggleCheat(cheat.id)}>{cheat.enabled ? 'ON' : 'OFF'}</button>
          <span className="pixel-cheat-code">{cheat.name && <strong>{cheat.name}</strong>}<code>{cheat.code.replace(/\+/g, ' · ')}</code></span>
          <button type="button" disabled={cheat.builtIn} aria-label={cheat.builtIn ? `内置金手指 ${cheat.name ?? cheat.code}` : `删除 ${cheat.code}`} onClick={() => onRemoveCheat(cheat.id)}>{cheat.builtIn ? '◆' : '×'}</button>
        </div>)}</div>
      </div>}
      <footer className="pixel-dialog-footer">
        {mode !== 'cheats' && <><button type="button" disabled={busySlot !== null} onClick={onExport}>导出本游戏</button><button type="button" disabled={busySlot !== null} onClick={() => importInput.current?.click()}>导入本游戏</button><input ref={importInput} hidden type="file" accept=".json,application/json" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) onImport(file) }} /></>}
        <button type="button" onClick={onClose}>返回游戏</button>
      </footer>
    </section>
  </div>
}

function KeyboardSettings({ bindings, onBind, onReset, onClose }: {
  bindings: KeyboardBindings; onBind: (action: KeyboardAction, key: string) => void; onReset: () => void; onClose: () => void
}) {
  const [capturing, setCapturing] = useState<KeyboardAction | null>(null)
  useEffect(() => {
    if (!capturing) return
    const capture = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation()
      if (event.repeat) return
      if (event.key === 'Escape') { setCapturing(null); return }
      if (event.key.toLowerCase() === 'p') return
      onBind(capturing, normalizeKeyboardKey(event.key))
      setCapturing(null)
    }
    window.addEventListener('keydown', capture, true)
    return () => window.removeEventListener('keydown', capture, true)
  }, [capturing, onBind])
  return <div className="pixel-dialog-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="pixel-dialog keyboard-dialog" role="dialog" aria-modal="true" aria-labelledby="keyboard-title">
      <header className="pixel-dialog-heading"><div><span>GAME BOY ADVANCE</span><h2 id="keyboard-title">系统设置</h2></div><button onClick={onClose} aria-label="关闭系统设置">×</button></header>
      <div className="binding-sections">
        <section><header><strong>游戏控制</strong><span>PLAYER 1</span></header><div className="binding-grid">{controllerActions.map(action => <button className={capturing === action ? 'is-capturing' : ''} key={action} onClick={() => setCapturing(action)}><span>{keyboardLabels[action]}</span><kbd>{capturing === action ? '按新键…' : displayKeyboardKey(bindings[action])}</kbd></button>)}</div></section>
        <section><header><strong>快捷功能</strong><span>SYSTEM</span></header><div className="binding-grid">{(['quickSave', 'quickLoad', 'speedToggle', 'cleanModeToggle'] as KeyboardAction[]).map(action => <button className={capturing === action ? 'is-capturing' : ''} key={action} onClick={() => setCapturing(action)}><span>{keyboardLabels[action]}</span><kbd>{capturing === action ? '按新键…' : displayKeyboardKey(bindings[action])}</kbd></button>)}</div></section>
      </div>
      <footer className="pixel-dialog-footer keyboard-footer"><span>{capturing ? '按下新按键，Esc 取消' : '重复键会自动交换；P 键打开设置'}</span><button type="button" onClick={onReset}>恢复默认</button><button type="button" onClick={onClose}>完成</button></footer>
    </section>
  </div>
}

function EmulatorPage({ route, keyboardBindings }: { route: Extract<Route, { page: 'play' }>; keyboardBindings: KeyboardBindings }) {
  const [status, setStatus] = useState<EmulatorStatus>('loading')
  const [activeTool, setActiveTool] = useState<GameTool | null>(null)
  const [slots, setSlots] = useState<SaveStateSlot[]>([])
  const [busySlot, setBusySlot] = useState<number | null>(null)
  const [quickBusy, setQuickBusy] = useState(false)
  const [quickNotice, setQuickNotice] = useState('')
  const [cleanMode, setCleanMode] = useState(false)
  const operationBusy = useRef(false)
  const lastCleanModeTap = useRef(0)
  const [speed, setSpeed] = useState<EmulatorSpeed>(1)
  const adapter = useRef<MgbaCoreAdapter | null>(null)
  const title = route.game.title
  const source = route.game.rom
  const cheatStorageKey = `gba-center:cheats:${route.game.id}`
  const [cheats, setCheats] = useState<CheatRule[]>(() => {
    try {
      const saved = localStorage.getItem(cheatStorageKey)
      const stored = saved === null ? [] : JSON.parse(saved) as CheatRule[]
      const currentBuiltIns = new Map((route.game.cheats ?? []).map(cheat => [cheat.id, cheat]))
      const migrated = stored.flatMap(cheat => {
        if (!cheat.builtIn) return [cheat]
        const current = currentBuiltIns.get(cheat.id)
        return current ? [{ ...current, enabled: cheat.enabled }] : []
      })
      const migratedIds = new Set(migrated.map(cheat => cheat.id))
      return [...migrated, ...(route.game.cheats ?? []).filter(cheat => !migratedIds.has(cheat.id))]
    } catch { return route.game.cheats ?? [] }
  })

  useEffect(() => {
    if (!source) { setStatus('error'); console.error('[GBA] 没有找到 ROM。'); return }
    const instance = new MgbaCoreAdapter({
      onReady: () => setStatus('ready'), onStart: () => setStatus('running'), onError: message => { console.error('[mGBA]', message); setStatus('error') },
    }, route.game.cover)
    adapter.current = instance
    void instance.load(source, route.game.rom.split('/').pop() ?? `${title}.gba`)
    return () => { instance.destroy(); adapter.current = null }
  }, [source, title])

  useEffect(() => {
    adapter.current?.setCheats(cheats)
    localStorage.setItem(cheatStorageKey, JSON.stringify(cheats))
  }, [cheatStorageKey, cheats])

  useEffect(() => {
    const keyMap = new Map(controllerActions.map(action => [keyboardBindings[action], action] as const))
    const handle = (event: KeyboardEvent, pressed: boolean) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const button = keyMap.get(normalizeKeyboardKey(event.key))
      if (!button) return
      event.preventDefault()
      adapter.current?.setInput(button, pressed)
    }
    const down = (event: KeyboardEvent) => handle(event, true)
    const up = (event: KeyboardEvent) => handle(event, false)
    const release = () => adapter.current?.releaseInputs()
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true); window.addEventListener('blur', release)
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', release) }
  }, [keyboardBindings])

  useEffect(() => {
    if (status !== 'running') return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || activeTool || operationBusy.current) return
      operationBusy.current = true
      setQuickBusy(true)
      void adapter.current?.saveState(-2).catch(() => undefined).finally(() => { operationBusy.current = false; setQuickBusy(false) })
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [activeTool, status])

  useEffect(() => {
    if (!quickNotice) return
    const timer = window.setTimeout(() => setQuickNotice(''), 1400)
    return () => window.clearTimeout(timer)
  }, [quickNotice])

  useEffect(() => {
    const leaveWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCleanMode(false)
    }
    window.addEventListener('keydown', leaveWithEscape, true)
    return () => window.removeEventListener('keydown', leaveWithEscape, true)
  }, [])

  const controlsDisabled = status === 'loading' || status === 'error'
  const sendInput = (button: GbaButton, pressed: boolean) => adapter.current?.setInput(button, pressed)
  const openTool = (tool: GameTool) => {
    if (controlsDisabled) return
    adapter.current?.releaseInputs()
    setActiveTool(tool)
    if (tool !== 'cheats') void adapter.current?.listSaveStates().then(setSlots).catch(reason => console.error('[GBA] 获取存档失败。', reason))
  }
  const quickSlot = (mode: 'save' | 'load') => {
    if (controlsDisabled || operationBusy.current) return
    operationBusy.current = true; setQuickBusy(true)
    const action = mode === 'save' ? adapter.current?.saveState(-1) : adapter.current?.loadState(-1)
    void action?.then(result => {
      if (mode === 'load' && !result) {
        console.error('[GBA] 快速槽位还没有存档。')
        return
      }
      setQuickNotice(mode === 'save' ? '快速存档完成' : '快速读档完成')
      triggerHapticFeedback()
    }).catch(reason => console.error('[GBA] 快速存读档失败。', reason)).finally(() => { operationBusy.current = false; setQuickBusy(false) })
  }
  const operateSlot = (mode: 'save' | 'load', slot: number) => {
    if (operationBusy.current) return
    const currentAdapter = adapter.current
    if (!currentAdapter) { console.error('[GBA] 游戏尚未准备好。'); return }
    operationBusy.current = true; setBusySlot(slot)
    const action = mode === 'save' ? currentAdapter.saveState(slot) : currentAdapter.loadState(slot)
    void action.then(result => {
      if (mode === 'save' && result) setSlots(current => [...current.filter(item => item.slot !== slot), result as SaveStateSlot].sort((a, b) => a.slot - b.slot))
      if (mode === 'load' && !result) console.error('[GBA] 该槽位没有存档。')
      triggerHapticFeedback()
    }).catch(reason => console.error('[GBA] 存读档失败。', reason)).finally(() => { operationBusy.current = false; setBusySlot(null) })
  }
  const deleteSlot = (slot: number) => {
    const currentAdapter = adapter.current
    if (!currentAdapter) { console.error('[GBA] 游戏尚未准备好。'); return }
    setSlots(current => current.filter(item => item.slot !== slot))
    triggerHapticFeedback()
    void currentAdapter.deleteState(slot).catch(reason => {
      console.error('[GBA] 删除存档失败。', reason)
      void currentAdapter.listSaveStates().then(setSlots).catch(refreshReason => console.error('[GBA] 刷新存档失败。', refreshReason))
    })
  }
  const cycleSpeed = () => {
    const next = gameSpeeds[(gameSpeeds.indexOf(speed) + 1) % gameSpeeds.length]
    if (adapter.current?.setSpeed(next)) { setSpeed(next); triggerHapticFeedback() }
  }
  const updateCheats = (next: CheatRule[]) => { setCheats(next); adapter.current?.setCheats(next); triggerHapticFeedback() }
  const leaveCleanMode = () => {
    setCleanMode(false)
  }
  const handleCleanModePointerUp = (pointerType: string) => {
    if (!cleanMode || pointerType === 'mouse') return
    const now = performance.now()
    if (now - lastCleanModeTap.current < 360) leaveCleanMode()
    lastCleanModeTap.current = now
  }
  const exportStates = () => {
    void adapter.current?.exportStates().then(async contents => {
      const backup = JSON.parse(contents) as Record<string, unknown>
      backup.cheats = cheats
      const gameTitle = route.game.title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/[. ]+$/g, '') || route.game.id
      const fileName = `${gameTitle}-存档.json`
      const file = new File([JSON.stringify(backup)], fileName, { type: 'application/json' })
      if (await shareBackupFile(file, fileName.replace(/\.json$/i, ''))) return
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }).catch(reason => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      console.error('[GBA] 导出存档失败。', reason)
    })
  }
  const importStates = (file: File) => {
    if (operationBusy.current) return
    operationBusy.current = true; setBusySlot(-99)
    void file.text().then(async contents => {
      const backup = JSON.parse(contents) as { cheats?: unknown }
      const result = await adapter.current?.importStates(contents)
      if (Array.isArray(backup.cheats)) {
        const restored = backup.cheats.filter((value): value is CheatRule => {
          if (!value || typeof value !== 'object') return false
          const cheat = value as Partial<CheatRule>
          return typeof cheat.id === 'string' && typeof cheat.code === 'string' && cheat.code.length <= 256 && typeof cheat.enabled === 'boolean'
        }).slice(0, 16)
        updateCheats(restored)
      }
      return result
    }).then(result => {
      if (result) setSlots(result)
      triggerHapticFeedback()
    }).catch(reason => console.error('[GBA] 导入存档失败。', reason)).finally(() => { operationBusy.current = false; setBusySlot(null) })
  }

  useEffect(() => {
    const handleQuickKey = (event: KeyboardEvent) => {
      if (event.repeat || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const key = normalizeKeyboardKey(event.key)
      const mode = key === keyboardBindings.quickSave ? 'save' : key === keyboardBindings.quickLoad ? 'load' : null
      const togglesCleanMode = key === keyboardBindings.cleanModeToggle
      if (!mode && key !== keyboardBindings.speedToggle && !togglesCleanMode) return
      event.preventDefault(); event.stopImmediatePropagation()
      if (mode) quickSlot(mode)
      else if (togglesCleanMode) {
        adapter.current?.releaseInputs()
        setActiveTool(null)
        setCleanMode(value => !value)
      }
      else cycleSpeed()
    }
    const blockKeyUp = (event: KeyboardEvent) => {
      const key = normalizeKeyboardKey(event.key)
      if (![keyboardBindings.quickSave, keyboardBindings.quickLoad, keyboardBindings.speedToggle, keyboardBindings.cleanModeToggle].includes(key)) return
      event.preventDefault(); event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', handleQuickKey, true); window.addEventListener('keyup', blockKeyUp, true)
    return () => { window.removeEventListener('keydown', handleQuickKey, true); window.removeEventListener('keyup', blockKeyUp, true) }
  }, [keyboardBindings, speed, status, quickBusy])

  return <main className={`player-page${cleanMode ? ' is-clean-mode' : ''}`}>
    <section className="player-layout console" aria-label="GBA 模拟器">
      <div className="control-zone control-zone-left side-controls side-controls-left">
        <ConsoleButton button="l" label="L" className="shoulder-control shoulder-control-left" disabled={controlsDisabled} onInput={sendInput} />
        <DirectionalPad disabled={controlsDisabled} onInput={sendInput} />
      </div>
      <div className="player-main game-column">
        <nav className="quick-tools" aria-label="游戏快捷功能">
          <HoldActionButton icon="▣" label="存档" disabled={quickBusy || controlsDisabled} onPress={() => openTool('save')} onHold={() => quickSlot('save')} />
          <HoldActionButton icon="▶" label="读档" disabled={quickBusy || controlsDisabled} onPress={() => openTool('load')} onHold={() => quickSlot('load')} />
          <button type="button" disabled={controlsDisabled} className={speed > 1 ? 'is-speed-active' : ''} onClick={cycleSpeed}><span>»</span>倍速 {speed}×</button>
          <button type="button" disabled={controlsDisabled} onClick={() => openTool('cheats')}><span>★</span>金手指</button>
        </nav>
        <div className="screen-stage">
          <div className="screen-frame screen-wrap" onDoubleClick={() => { if (cleanMode) leaveCleanMode() }} onPointerUp={event => handleCleanModePointerUp(event.pointerType)}><div id="game" className="emulator-container emulator-host" />
            {status === 'loading' && <div className="loading-screen"><div className="loading-logo">GBA</div><span>mGBA CORE</span><i /></div>}
          </div>
        </div>
        <div className="center-controls" aria-label="功能键"><ConsoleButton button="select" label="SELECT" className="utility-control utility-button" disabled={controlsDisabled} onInput={sendInput} /><ConsoleButton button="start" label="START" className="utility-control utility-button" disabled={controlsDisabled} onInput={sendInput} /></div>
      </div>
      <div className="control-zone control-zone-right side-controls side-controls-right">
        <ConsoleButton button="r" label="R" className="shoulder-control shoulder-control-right" disabled={controlsDisabled} onInput={sendInput} />
        <div className="action-controls" aria-label="动作键"><ConsoleButton button="b" label="B" className="action-control action-control-b action-button" disabled={controlsDisabled} onInput={sendInput} /><ConsoleButton button="a" label="A" className="action-control action-control-a action-button" disabled={controlsDisabled} onInput={sendInput} /></div>
      </div>
      <span className="player-gba-logo" aria-hidden="true"><small>GAME BOY</small><strong>ADVANCE</strong></span>
    </section>
    {quickNotice && <div className="player-notice" role="status" aria-live="polite">{quickNotice}</div>}
    {activeTool && <GameToolsDialog mode={activeTool} slots={slots} busySlot={busySlot} cheats={cheats} onSave={slot => operateSlot('save', slot)} onLoad={slot => operateSlot('load', slot)} onDelete={deleteSlot} onExport={exportStates} onImport={importStates} onAddCheat={code => updateCheats([...cheats, { id: crypto.randomUUID(), code, enabled: true }].slice(0, 16))} onToggleCheat={id => updateCheats(cheats.map(cheat => cheat.id === id ? { ...cheat, enabled: !cheat.enabled } : cheat))} onRemoveCheat={id => updateCheats(cheats.filter(cheat => cheat.id !== id || cheat.builtIn))} onClose={() => setActiveTool(null)} />}
  </main>
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => {
    const id = new URLSearchParams(window.location.search).get('game')
    const game = games.find(candidate => candidate.id === id)
    return game ? { page: 'play', game } : { page: 'home' }
  })
  const [keyboardBindings, setKeyboardBindings] = useState<KeyboardBindings>(loadKeyboardBindings)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    const onPopState = () => {
      const id = new URLSearchParams(window.location.search).get('game')
      const game = games.find(candidate => candidate.id === id)
      setRoute(game ? { page: 'play', game } : { page: 'home' })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'p' || event.repeat || document.querySelector('.binding-grid .is-capturing')) return
      event.preventDefault(); event.stopImmediatePropagation(); setShowSettings(value => !value)
    }
    const block = (event: KeyboardEvent) => { if (event.key.toLowerCase() === 'p') { event.preventDefault(); event.stopImmediatePropagation() } }
    window.addEventListener('keydown', toggle, true); window.addEventListener('keyup', block, true)
    return () => { window.removeEventListener('keydown', toggle, true); window.removeEventListener('keyup', block, true) }
  }, [])

  const goHome = () => {
    window.history.pushState({}, '', '/')
    setRoute({ page: 'home' })
  }
  const openGame = (game: Game) => {
    window.history.pushState({}, '', `/?game=${encodeURIComponent(game.id)}`)
    setRoute({ page: 'play', game })
  }
  const saveBindings = (next: KeyboardBindings) => { localStorage.setItem(keyboardBindingsKey, JSON.stringify(next)); setKeyboardBindings(loadKeyboardBindings()) }
  const bindKey = (action: KeyboardAction, key: string) => {
    const next = { ...keyboardBindings }
    const oldKey = next[action]
    const conflict = bindingActions.find(candidate => candidate !== action && next[candidate] === key)
    next[action] = key
    if (conflict) next[conflict] = oldKey
    saveBindings(next)
  }

  return <>
    <div className="pwa-titlebar-drag-region" aria-hidden="true" />
    {route.page === 'home'
      ? <HomePage openGame={openGame} openSettings={() => setShowSettings(true)} />
      : <EmulatorPage route={route} keyboardBindings={keyboardBindings} />}
    {showSettings && <KeyboardSettings bindings={keyboardBindings} onBind={bindKey} onReset={() => saveBindings({ ...defaultKeyboardBindings })} onClose={() => setShowSettings(false)} />}
  </>
}
