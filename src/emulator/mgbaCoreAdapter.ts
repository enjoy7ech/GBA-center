import { deleteSaveState, exportGameSaveStates, importGameSaveStates, listSaveStates, readSaveState, writeSaveState } from './saveStateStore'
import type { CheatRule, EmulatorSpeed, GbaButton, SaveStateSlot } from './types'

type MgbaModule = {
  canvas?: HTMLCanvasElement
  noInitialRun?: boolean
  arguments?: string[]
  callbacks?: Record<string, unknown>
  parent?: HTMLElement
  locateFile?: (path: string) => string
  getSavExt?: () => string
  print?: (message: string) => void
  printErr?: (message: string) => void
  callMain?: (args: string[]) => void
  pauseMainLoop?: () => void
  resumeMainLoop?: () => void
  cwrap?: (name: string, returnType: string | null, argumentTypes: string[]) => (...args: never[]) => unknown
  HEAPU8?: Uint8Array
  FS?: {
    mkdir: (path: string) => void
    writeFile: (path: string, data: Uint8Array) => void
    readFile?: (path: string) => Uint8Array
    readdir?: (path: string) => string[]
    unlink: (path: string) => void
  }
}

type MgbaFactory = (module: MgbaModule) => Promise<MgbaModule>

export type EmulatorCallbacks = {
  onReady: () => void
  onStart: () => void
  onError: (message: string) => void
}

const ROM_PATH = '/game.gba'
const STATE_PATH = '/game.state'
const MINIMUM_PRESS_MS = 56

const inputIndex: Record<GbaButton, number> = {
  b: 0,
  select: 2,
  start: 3,
  up: 4,
  down: 5,
  left: 6,
  right: 7,
  a: 8,
  l: 10,
  r: 11,
}

export class MgbaCoreAdapter {
  private module: MgbaModule | null = null
  private canvas: HTMLCanvasElement | null = null
  private generation = 0
  private gameId = 'game'
  private speed: EmulatorSpeed = 1
  private speedChangeTimer: number | null = null
  private heldButtons = new Set<GbaButton>()
  private pressTimes = new Map<GbaButton, number>()
  private releaseTimers = new Map<GbaButton, number>()
  private simulateInput: ((player: number, index: number, value: number) => void) | null = null
  private saveStateInfo: (() => string) | null = null
  private loadStateFile: ((path: string, slot: number) => number) | null = null
  private setFastForwardRatio: ((ratio: number) => void) | null = null
  private toggleFastForward: ((active: number) => void) | null = null
  private resetCheats: (() => void) | null = null
  private setCheat: ((index: number, enabled: number, code: string) => void) | null = null
  private cheats: CheatRule[] = []

  constructor(private readonly callbacks: EmulatorCallbacks, private readonly fallbackThumbnail = '') {}

  async load(gameUrl: string | File, gameName: string) {
    this.destroy()
    const generation = ++this.generation
    this.gameId = gameName.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').toLowerCase() || 'game'

    try {
      const rom = gameUrl instanceof File ? await gameUrl.arrayBuffer() : await this.fetchRom(gameUrl)
      if (generation !== this.generation) return

      const host = document.querySelector<HTMLElement>('#game')
      if (!host) throw new Error('找不到模拟器画布容器。')
      const canvas = document.createElement('canvas')
      canvas.className = 'emulator-canvas'
      canvas.tabIndex = 0
      canvas.setAttribute('aria-label', `正在运行 ${gameName}`)
      host.replaceChildren(canvas)
      this.canvas = canvas

      const dynamicImport = new Function('url', 'return import(url)') as (url: string) => Promise<{ default: MgbaFactory }>
      const imported = await dynamicImport('/cores/mgba_libretro.js')
      const module = await imported.default({
        canvas,
        noInitialRun: true,
        arguments: [],
        callbacks: {},
        parent: host,
        locateFile: path => `/cores/${path}`,
        getSavExt: () => '.sav',
        print: message => {
          if (!isCoreBuildBanner(message)) console.info('[mGBA]', message)
        },
        printErr: message => {
          if (!isCoreBuildBanner(message)) console.warn('[mGBA]', message)
        },
      })
      if (generation !== this.generation) {
        module.pauseMainLoop?.()
        return
      }

      this.module = module
      this.prepareFileSystem(new Uint8Array(rom))
      this.bindCoreFunctions()
      this.callbacks.onReady()
      module.callMain?.([ROM_PATH])
      module.resumeMainLoop?.()
      window.setTimeout(() => {
        if (generation === this.generation) this.applyCheats()
      }, 0)
      this.callbacks.onStart()
    } catch (error) {
      if (generation !== this.generation) return
      this.callbacks.onError(error instanceof Error ? error.message : 'mGBA 核心加载失败。')
    }
  }

  setInput(button: GbaButton, pressed: boolean) {
    if (!this.simulateInput) return
    if (pressed) {
      const timer = this.releaseTimers.get(button)
      if (timer !== undefined) {
        window.clearTimeout(timer)
        this.releaseTimers.delete(button)
      }
      if (this.heldButtons.has(button)) return
      this.heldButtons.add(button)
      this.pressTimes.set(button, performance.now())
      this.canvas?.focus({ preventScroll: true })
      this.simulateInput(0, inputIndex[button], 1)
      return
    }

    if (!this.heldButtons.has(button) || this.releaseTimers.has(button)) return
    const delay = Math.max(0, MINIMUM_PRESS_MS - (performance.now() - (this.pressTimes.get(button) ?? 0)))
    if (delay > 0) {
      const timer = window.setTimeout(() => {
        this.releaseTimers.delete(button)
        this.releaseButton(button)
      }, delay)
      this.releaseTimers.set(button, timer)
    } else {
      this.releaseButton(button)
    }
  }

  async saveState(slot: number): Promise<SaveStateSlot> {
    const stateInfo = this.saveStateInfo?.().split('|')
    if (!stateInfo || stateInfo[2] !== '1' || !this.module?.HEAPU8) throw new Error('游戏尚未准备好')
    const size = Number.parseInt(stateInfo[0], 10)
    const start = Number.parseInt(stateInfo[1], 10)
    const state = this.module.HEAPU8.slice(start, start + size)
    return writeSaveState(this.gameId, slot, state, await this.captureThumbnail())
  }

  async loadState(slot: number): Promise<SaveStateSlot | null> {
    const record = await readSaveState(this.gameId, slot)
    if (!record || !this.module?.FS || !this.loadStateFile) return null
    try { this.module.FS.unlink(STATE_PATH) } catch { /* No previous state. */ }
    this.module.FS.writeFile(STATE_PATH, record.data)
    this.loadStateFile(STATE_PATH, 0)
    return { gameId: record.gameId, slot: record.slot, updatedAt: record.updatedAt, thumbnail: record.thumbnail }
  }

  listSaveStates() {
    return listSaveStates(this.gameId)
  }

  async deleteState(slot: number) {
    await deleteSaveState(this.gameId, slot)
  }

  exportStates() {
    return exportGameSaveStates(this.gameId)
  }

  importStates(contents: string) {
    return importGameSaveStates(this.gameId, contents)
  }

  getGameId() {
    return this.gameId
  }

  setSpeed(speed: EmulatorSpeed) {
    if (!this.module || speed === this.speed) return false
    if (this.speedChangeTimer !== null) {
      window.clearTimeout(this.speedChangeTimer)
      this.speedChangeTimer = null
    }
    this.toggleFastForward?.(0)
    this.setFastForwardRatio?.(speed)
    this.speed = speed
    if (speed > 1) {
      // EmulatorJS/RetroArch needs one event-loop turn to commit the new
      // throttle ratio before fast-forward is enabled. Re-enabling it in the
      // same call stack can deadlock the Emscripten core during GBA transitions.
      this.speedChangeTimer = window.setTimeout(() => {
        this.speedChangeTimer = null
        if (this.module && this.speed === speed) this.toggleFastForward?.(1)
      }, 10)
    }
    return true
  }

  setCheats(cheats: CheatRule[]) {
    this.cheats = cheats
    this.applyCheats()
  }

  private applyCheats() {
    if (!this.resetCheats || !this.setCheat) return
    this.resetCheats()
    this.cheats.forEach((cheat, index) => this.setCheat?.(index, cheat.enabled ? 1 : 0, cheat.code))
  }

  releaseInputs() {
    for (const timer of this.releaseTimers.values()) window.clearTimeout(timer)
    this.releaseTimers.clear()
    for (const button of [...this.heldButtons]) this.releaseButton(button)
  }

  destroy() {
    this.generation++
    if (this.speedChangeTimer !== null) {
      window.clearTimeout(this.speedChangeTimer)
      this.speedChangeTimer = null
    }
    this.releaseInputs()
    this.module?.pauseMainLoop?.()
    this.canvas?.remove()
    this.module = null
    this.canvas = null
    this.simulateInput = null
    this.saveStateInfo = null
    this.loadStateFile = null
    this.setFastForwardRatio = null
    this.toggleFastForward = null
    this.resetCheats = null
    this.setCheat = null
    this.cheats = []
    this.speed = 1
    this.gameId = 'game'
  }

  private async fetchRom(url: string) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`ROM 读取失败：${response.status}`)
    return response.arrayBuffer()
  }

  private prepareFileSystem(rom: Uint8Array) {
    const fileSystem = this.module?.FS
    if (!fileSystem) throw new Error('mGBA 虚拟文件系统尚未准备好。')
    this.mkdir('/home')
    this.mkdir('/home/web_user')
    this.mkdir('/home/web_user/.config')
    this.mkdir('/home/web_user/.config/retroarch')
    fileSystem.writeFile(ROM_PATH, rom)
    fileSystem.writeFile('/home/web_user/.config/retroarch/retroarch.cfg', new TextEncoder().encode([
      'audio_latency = "64"',
      'video_vsync = "true"',
      'video_smooth = "false"',
      'fastforward_ratio = "2.0"',
      'video_force_aspect = "true"',
      'video_aspect_ratio_auto = "true"',
      'video_font_enable = "false"',
      'screenshot_directory = "/"',
      'screenshots_in_content_dir = "false"',
      'video_gpu_screenshot = "true"',
      'notification_show_screenshot = "false"',
    ].join('\n')))
  }

  private mkdir(path: string) {
    try { this.module?.FS?.mkdir(path) } catch { /* Directory already exists. */ }
  }

  private bindCoreFunctions() {
    const cwrap = this.module?.cwrap
    if (!cwrap) throw new Error('mGBA 核心接口不可用。')
    this.simulateInput = cwrap('simulate_input', null, ['number', 'number', 'number']) as typeof this.simulateInput
    this.saveStateInfo = cwrap('save_state_info', 'string', []) as typeof this.saveStateInfo
    this.loadStateFile = cwrap('load_state', 'number', ['string', 'number']) as typeof this.loadStateFile
    this.setFastForwardRatio = cwrap('set_ff_ratio', null, ['number']) as typeof this.setFastForwardRatio
    this.toggleFastForward = cwrap('toggle_fastforward', null, ['number']) as typeof this.toggleFastForward
    this.resetCheats = cwrap('reset_cheat', null, []) as typeof this.resetCheats
    this.setCheat = cwrap('set_cheat', null, ['number', 'number', 'string']) as typeof this.setCheat
  }

  private async captureThumbnail() {
    const canvas = this.canvas
    if (!canvas) return ''

    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const directThumbnail = this.renderThumbnail(canvas, true)
    if (directThumbnail) return directThumbnail

    // WebGL clears its drawing buffer after compositing. captureStream reads
    // the composed frames, so it remains reliable even when drawImage(canvas)
    // only sees an empty framebuffer.
    if (typeof canvas.captureStream === 'function') {
      const stream = canvas.captureStream(30)
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      try {
        await Promise.race([
          video.play(),
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('截图视频流超时')), 500)),
        ])
        for (let attempt = 0; attempt < 8; attempt++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) continue
          const thumbnail = this.renderThumbnail(video, true)
          if (thumbnail) return thumbnail
        }
      } catch {
        // Mobile browsers may not support canvas capture streams.
      } finally {
        stream.getTracks().forEach(track => track.stop())
        video.srcObject = null
      }
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const thumbnail = this.renderThumbnail(canvas, true)
      if (thumbnail) return thumbnail
    }
    return this.fallbackThumbnail
  }

  private renderThumbnail(source: CanvasImageSource, requireVisiblePixels = false) {
    try {
      const preview = document.createElement('canvas')
      preview.width = 240
      preview.height = 160
      const context = preview.getContext('2d')
      if (!context) return ''
      context.imageSmoothingEnabled = false
      context.fillStyle = '#050708'
      context.fillRect(0, 0, preview.width, preview.height)
      context.drawImage(source, 0, 0, preview.width, preview.height)
      if (requireVisiblePixels) {
        const pixels = context.getImageData(0, 0, preview.width, preview.height).data
        let visibleSamples = 0
        for (let index = 0; index < pixels.length; index += 64) {
          if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 36) visibleSamples++
        }
        if (visibleSamples < 20) return ''
      }
      return preview.toDataURL('image/jpeg', .76)
    } catch { return '' }
  }


  private releaseButton(button: GbaButton) {
    if (!this.heldButtons.delete(button)) return
    this.pressTimes.delete(button)
    this.simulateInput?.(0, inputIndex[button], 0)
  }
}

function isCoreBuildBanner(message: string) {
  return message === 'Built for EmulatorJS'
    || message.startsWith('Download a copy from https://github.com/EmulatorJS/')
    || message.startsWith('View the licence here: https://github.com/EmulatorJS/')
}
