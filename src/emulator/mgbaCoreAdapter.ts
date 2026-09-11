import { updateSaveThumbnail, listSaveHistory, readSaveHistory, preserveBeforeLoad, type SaveStateRecord, deleteSaveState, exportGameSaveStates, importGameSaveStates, listSaveStates, readSaveState, writeSaveState } from './saveStateStore'
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
const MGBA_CORE_OPTIONS = [
  // Plus/hack ROMs can retain the signature of a known retail-game idle loop
  // while repurposing that code for event processing. Skipping it can leave
  // scripted units stationary and soft-lock tutorials/cutscenes.
  `mgba_idle_optimization = "Don't Remove"`,
  'mgba_frameskip = "0"',
].join('\n')

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
  private autoSaveAllowed = false
  private releaseSession: (() => void) | null = null
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
      await this.acquireSession(this.gameId)
      if (generation !== this.generation) { this.releaseSession?.(); this.releaseSession = null; return }
      this.autoSaveAllowed = (await listSaveStates(this.gameId)).length === 0
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
        callbacks: {
          setupCoreSettingFile: (path: string) => this.writeCoreSettings(path),
        },
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

  private snapshot() {
    const info = this.saveStateInfo?.().split('|')
    const heap = this.module?.HEAPU8
    if (!info || info[2] !== '1' || !heap) throw new Error('游戏尚未准备好，未保存。')
    const size = Number(info[0]), start = Number(info[1])
    if (!Number.isInteger(size) || !Number.isInteger(start) || size <= 0 || start < 0 || start + size > heap.length) throw new Error('核心返回无效存档，已停止覆盖。')
    return heap.slice(start, start + size)
  }

  private thumbnail() {
    // A preview must never delay or prevent writing the actual save bytes.
    try { return this.canvas ? this.renderThumbnail(this.canvas, true) || this.fallbackThumbnail : this.fallbackThumbnail }
    catch { return this.fallbackThumbnail }
  }

  private async capturePreview(): Promise<string> {
    const canvas = this.canvas
    if (!canvas?.captureStream || document.visibilityState !== 'visible') return ''
    let stream: MediaStream | undefined
    let video: HTMLVideoElement | undefined
    try {
      stream = canvas.captureStream(30)
      video = document.createElement('video')
      video.muted = true; video.playsInline = true; video.srcObject = stream
      void video.play().catch(() => undefined)
      const deadline = performance.now() + 500
      while (performance.now() < deadline && document.visibilityState === 'visible') {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const preview = this.renderThumbnail(video, true)
          if (preview) return preview
        }
        await new Promise<void>(resolve => window.setTimeout(resolve, 25))
      }
    } catch { /* A failed preview cannot invalidate a committed save. */ }
    finally {
      stream?.getTracks().forEach(track => track.stop())
      if (video) video.srcObject = null
    }
    return ''
  }

  canAutoSave() { return this.autoSaveAllowed }

  async saveState(slot: number, automatic = false): Promise<SaveStateSlot | null> {
    if (automatic && !this.autoSaveAllowed) return null
    const gameId = this.gameId, generation = this.generation
    const result = await writeSaveState(gameId, slot, this.snapshot(), this.thumbnail(), automatic ? 'auto' : 'overwrite')
    if (!automatic && generation === this.generation) this.autoSaveAllowed = true
    const preview = await this.capturePreview()
    if (preview && generation === this.generation) {
      try { await updateSaveThumbnail(gameId, slot, result.updatedAt, preview); result.thumbnail = preview } catch { /* Save bytes are already committed. */ }
    }
    return result
  }

  private async applyState(record: SaveStateRecord): Promise<SaveStateSlot> {
    const module = this.module, load = this.loadStateFile, generation = this.generation
    if (!module?.FS || !load) throw new Error('游戏尚未准备好。')
    await preserveBeforeLoad(this.gameId, this.snapshot(), this.thumbnail())
    if (generation !== this.generation) throw new Error('游戏已切换，读档已取消。')
    try { module.FS.unlink(STATE_PATH) } catch { /* No previous state. */ }
    module.FS.writeFile(STATE_PATH, record.data)
    load(STATE_PATH, 0)
    this.autoSaveAllowed = true
    return { gameId: record.gameId, slot: record.slot, updatedAt: record.updatedAt, thumbnail: record.thumbnail }
  }

  async loadState(slot: number): Promise<SaveStateSlot | null> {
    const record = await readSaveState(this.gameId, slot)
    return record ? this.applyState(record) : null
  }
  async loadHistory(historyId: string) { return this.applyState(await readSaveHistory(this.gameId, historyId)) }
  listHistory() { return listSaveHistory(this.gameId) }
  listSaveStates() { return listSaveStates(this.gameId) }
  async deleteState(slot: number) { await deleteSaveState(this.gameId, slot) }
  async exportStates() {
    // Explicit export captures the current game in AUTO; its previous value is archived.
    await this.saveState(-2)
    return exportGameSaveStates(this.gameId)
  }
  async importStates(contents: string) {
    const result = await importGameSaveStates(this.gameId, contents)
    // Import changes stored slots, not the live core. Wait for an explicit load/save.
    this.autoSaveAllowed = false
    return result
  }

  private async acquireSession(gameId: string) {
    if (!navigator.locks) throw new Error('当前浏览器不支持安全存档锁，请更新浏览器。')
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request('gba-center:play:' + gameId, { ifAvailable: true }, async lock => {
        if (!lock) { reject(new Error('这个游戏已在另一个标签页运行，请关闭那个标签页后重试。')); return }
        await new Promise<void>(release => { this.releaseSession = release; resolve() })
      }).catch(reject)
    })
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
    // This EmulatorJS core still parses/registers active codes passed with
    // enabled=0, so rebuild the list and explicitly choose active or restore bytes.
    let index = 0
    this.cheats.forEach(cheat => {
      // mGBA removes a ROM-patch rule without restoring the original instruction.
      // Built-in ROM patches can provide the original bytes so OFF takes effect
      // immediately, without requiring the player to reload the game.
      const code = cheat.enabled ? cheat.code : cheat.restoreCode
      if (code) this.setCheat?.(index++, 1, code)
    })
  }

  releaseInputs() {
    for (const timer of this.releaseTimers.values()) window.clearTimeout(timer)
    this.releaseTimers.clear()
    for (const button of [...this.heldButtons]) this.releaseButton(button)
  }

  destroy() {
    this.generation++
    this.autoSaveAllowed = false
    this.releaseSession?.()
    this.releaseSession = null
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
      'audio_driver = "rwebaudio"',
      'audio_out_rate = "48000"',
      'audio_resampler_quality = "3"',
      'audio_latency = "256"',
      'audio_sync = "true"',
      'audio_rate_control = "true"',
      'audio_rate_control_delta = "0.005000"',
      'audio_max_timing_skew = "0.050000"',
      'audio_fastforward_mute = "false"',
      'audio_fastforward_speedup = "true"',
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

  private writeCoreSettings(path: string) {
    const fileSystem = this.module?.FS
    if (!fileSystem) return
    const directories = path.split('/').slice(1, -1)
    let current = ''
    for (const directory of directories) {
      current += `/${directory}`
      this.mkdir(current)
    }
    fileSystem.writeFile(path, new TextEncoder().encode(MGBA_CORE_OPTIONS))
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
