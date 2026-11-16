// The media player of the editor tab: a <video> on a black stage (or a cover for audio), overlays
// for errors, info and feedback, and a control bar drawn from Orca's theme.

import {
  RATES,
  actionForKey,
  baseName,
  clamp,
  formatNumber,
  formatPercentOf,
  formatRate,
  formatTime,
  infoRows,
  seekTarget,
  stepRate,
  timestampForFile,
  type KeyAction
} from './format'
import type { Strings } from './i18n'
import { icon, type IconName } from './icons'
import { FrameRateMeter, displayFps, frameStepTarget, stepAnchor, type PendingStep } from './rate'

export type VideoSource = {
  /** A `blob:` URL; the player revokes it when it loads another source or is disposed. */
  url: string
  name: string
  size: number
  /** The file type shown in the info overlay, e.g. `.mkv`. */
  type: string
  /** An audio-only file: show a cover and hide the picture-only controls. */
  audio?: boolean
  /** The exact frame rate, when it is known before playback (the AVI decoder's). */
  fps?: number
  /** Seconds per frame as the container declares it (Matroska, MP4), for frame steps. */
  frameDuration?: number
  /** False when the container has no video track; a video file without a picture then gets the audio cover. */
  hasVideoTrack?: boolean
  /** The video codec's name from the container, for the notice when Chromium cannot decode it. */
  videoCodec?: string
  /** The sound codec, when every sound track is in one this player cannot play: it says so. */
  droppedSound?: string
  /** A sound track in a codec that plays gave no sound (a damaged AVI sound stream): it says so. */
  soundUndecoded?: boolean
}

export type LoadOptions = {
  /** Keep the playhead and play state of the previous source (an outside change of the same file). */
  keepPosition?: boolean
  /** Start playing once the video can play. */
  autoplay?: boolean
}

export type PlayerOptions = {
  strings: Strings
  /** Called when a clip ends without repeat. */
  onEnded?: () => void
  /** Listen for the page's keyboard shortcuts (default true). */
  keyboard?: boolean
  /** Orca's UI language (`orca.locale`), for numbers: `1,5 МБ` in Russian. */
  locale?: string
}

type Prefs = { volume: number; muted: boolean; rate: number; loop: boolean }

const PREFS_KEY = 'video-viewer.prefs'
const DEFAULT_FPS = 30

function loadPrefs(): Prefs {
  const fallback: Prefs = { volume: 1, muted: false, rate: 1, loop: false }
  try {
    const raw = globalThis.localStorage?.getItem(PREFS_KEY)
    if (!raw) {
      return fallback
    }
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      volume: typeof parsed.volume === 'number' ? clamp(parsed.volume, 0, 1) : fallback.volume,
      muted: parsed.muted === true,
      rate: typeof parsed.rate === 'number' && parsed.rate > 0 ? parsed.rate : fallback.rate,
      loop: parsed.loop === true
    }
  } catch {
    return fallback
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage can be unavailable in a sandboxed frame; preferences then last for the session.
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs: Record<string, string> = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) {
    node.className = className
  }
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, value)
  }
  return node
}

function iconButton(name: IconName, label: string, extraClass = ''): HTMLButtonElement {
  const button = el('button', `vv-btn ${extraClass}`.trim(), { type: 'button', title: label, 'aria-label': label })
  button.innerHTML = icon(name)
  return button
}

function setIcon(button: HTMLButtonElement, name: IconName, label: string): void {
  button.innerHTML = icon(name)
  button.title = label
  button.setAttribute('aria-label', label)
}

function setFill(range: HTMLInputElement): void {
  const min = Number(range.min) || 0
  const max = Number(range.max) || 1
  const value = Number(range.value)
  const fraction = max > min ? (value - min) / (max - min) : 0
  range.style.setProperty('--fill', `${clamp(fraction, 0, 1) * 100}%`)
}

export class Player {
  readonly root: HTMLDivElement
  private readonly s: Strings
  private readonly options: PlayerOptions
  private readonly video: HTMLVideoElement
  private readonly stage: HTMLDivElement
  private readonly flash: HTMLDivElement
  private readonly badge: HTMLDivElement
  private readonly message: HTMLDivElement
  private readonly info: HTMLDListElement
  private readonly toast: HTMLDivElement
  private readonly notice: HTMLDivElement
  private readonly cover: HTMLDivElement
  private readonly coverType: HTMLDivElement
  private readonly playButton: HTMLButtonElement
  private readonly muteButton: HTMLButtonElement
  private readonly loopButton: HTMLButtonElement
  private readonly fitButton: HTMLButtonElement
  private readonly infoButton: HTMLButtonElement
  private readonly snapshotButton: HTMLButtonElement
  private readonly frameButtons: HTMLButtonElement[]
  private readonly seek: HTMLInputElement
  private readonly volume: HTMLInputElement
  private readonly rate: HTMLSelectElement
  private readonly time: HTMLSpanElement
  private source: VideoSource | null = null
  private prefs: Prefs = loadPrefs()
  private readonly meter = new FrameRateMeter()
  /** The frame rate measured during playback, once it is solid. */
  private measuredFps: number | null = null
  /** Media time of the frame on screen, from requestVideoFrameCallback. */
  private shownTime: number | null = null
  private pendingStep: PendingStep | null = null
  private seeking = false
  private actualSize = false
  private timers = new Map<string, number>()
  private disposers: Array<() => void> = []

  constructor(options: PlayerOptions) {
    this.options = options
    this.s = options.strings
    const s = this.s

    this.root = el('div', 'vv-player')
    this.stage = el('div', 'vv-stage empty', { tabindex: '-1' })
    this.video = el('video', 'vv-video')
    this.video.preload = 'auto'
    this.video.playsInline = true
    this.flash = el('div', 'vv-flash')
    this.badge = el('div', 'vv-badge')
    this.message = el('div', 'vv-message')
    this.info = el('dl', 'vv-info')
    this.toast = el('div', 'vv-toast', { role: 'status' })
    this.notice = el('div', 'vv-notice', { role: 'status' })
    this.cover = el('div', 'vv-cover')
    this.cover.innerHTML = icon('music')
    this.coverType = el('div', 'vv-cover-type')
    this.cover.append(this.coverType)
    this.stage.append(this.video, this.cover, this.flash, this.badge, this.notice, this.info, this.message)

    const bar = el('div', 'vv-bar')
    const seekRow = el('div', 'vv-seek-row')
    this.seek = el('input', 'vv-range seek', { type: 'range', min: '0', max: '0', step: 'any', value: '0', 'aria-label': s.seek })
    this.time = el('span', 'vv-time')
    seekRow.append(this.seek, this.time)

    const controls = el('div', 'vv-controls')
    this.playButton = iconButton('play', s.play)
    const frameBack = iconButton('frameBack', s.frameBack, 'vv-optional vv-video-only')
    const frameForward = iconButton('frameForward', s.frameForward, 'vv-optional vv-video-only')
    this.frameButtons = [frameBack, frameForward]
    this.muteButton = iconButton('volume', s.mute)
    this.volume = el('input', 'vv-range volume', { type: 'range', min: '0', max: '1', step: '0.01', 'aria-label': s.volume, title: s.volume })
    this.rate = el('select', 'vv-select', { title: s.speed, 'aria-label': s.speed })
    for (const value of RATES) {
      const option = el('option')
      option.value = String(value)
      option.textContent = formatRate(value, options.locale)
      this.rate.append(option)
    }
    this.loopButton = iconButton('loop', s.loop)
    this.snapshotButton = iconButton('camera', s.snapshot, 'vv-optional vv-video-only')
    this.fitButton = iconButton('actual', s.fit, 'vv-optional vv-video-only')
    this.infoButton = iconButton('info', s.info)
    controls.append(
      this.playButton,
      frameBack,
      frameForward,
      this.muteButton,
      this.volume,
      el('span', 'vv-spacer'),
      this.rate,
      this.loopButton,
      this.snapshotButton,
      this.fitButton,
      this.infoButton
    )
    bar.append(seekRow, controls)
    this.root.append(this.stage, bar, this.toast)

    if (!globalThis.orca?.files) {
      this.snapshotButton.classList.add('vv-hidden')
    }

    this.applyPrefs()
    this.wire(frameBack, frameForward)
    this.renderTime()
    this.setControlsEnabled(false)
  }

  /** Plays `source`, replacing the current one. */
  load(source: VideoSource, options: LoadOptions = {}): void {
    const previous = this.source
    const resumeAt = options.keepPosition && previous ? this.video.currentTime : 0
    const resumePlaying = options.keepPosition && previous ? !this.video.paused : options.autoplay === true
    this.source = source
    this.meter.reset()
    this.measuredFps = null
    this.shownTime = null
    this.pendingStep = null
    this.hideMessage()
    this.hideNotice()
    this.stage.classList.remove('empty')
    this.setAudio(source.audio === true)
    this.video.src = source.url
    this.video.load()
    if (previous && previous.url !== source.url) {
      URL.revokeObjectURL(previous.url)
    }
    const onReady = () => void this.ready(source, resumeAt, resumePlaying)
    this.video.addEventListener('loadedmetadata', onReady, { once: true })
    this.watchFrames()
  }

  /** The metadata is in: picks picture or cover, finds a missing duration, restores the playhead. */
  private async ready(source: VideoSource, resumeAt: number, resumePlaying: boolean): Promise<void> {
    const v = this.video
    if (!v.videoWidth) {
      if (source.audio || source.hasVideoTrack === false) {
        this.setAudio(true)
      } else {
        // A video file whose picture Chromium cannot decode, while its sound plays: say so
        // instead of passing it off as an audio file.
        this.setNoPicture(source.videoCodec)
      }
    } else if (source.droppedSound) {
      this.showNotice(this.s.soundDropped.replace('{codec}', source.droppedSound))
    } else if (source.soundUndecoded) {
      this.showNotice(this.s.soundUndecoded)
    }
    await this.findDuration()
    if (this.source !== source) {
      return
    }
    if (resumeAt > 0) {
      v.currentTime = Math.min(resumeAt, this.mediaDuration() || resumeAt)
    }
    this.applyRate()
    if (resumePlaying) {
      void v.play().catch(() => undefined)
    }
    this.renderTime()
    this.renderInfo()
  }

  /**
   * WebM and Matroska written by recorders (MediaRecorder, a pipe, an unfinished capture) carry no
   * duration, so Chromium reports Infinity until playback reaches the end. Seeking far past the
   * end makes it scan the file and report the real duration; then the playhead goes back to 0.
   */
  private async findDuration(): Promise<void> {
    const v = this.video
    if (v.duration !== Number.POSITIVE_INFINITY) {
      return
    }
    await new Promise<void>((resolve) => {
      let timer = 0
      const finish = () => {
        window.clearTimeout(timer)
        v.removeEventListener('durationchange', changed)
        v.removeEventListener('seeked', finish)
        resolve()
      }
      const changed = () => {
        if (Number.isFinite(v.duration)) finish()
      }
      timer = window.setTimeout(finish, 5000)
      v.addEventListener('durationchange', changed)
      v.addEventListener('seeked', finish)
      v.currentTime = 1e101
    })
    v.currentTime = 0
  }

  /** The duration, or where the seekable range ends when Chromium still has none; NaN if neither. */
  private mediaDuration(): number {
    const v = this.video
    if (Number.isFinite(v.duration)) {
      return v.duration
    }
    const ranges = v.seekable
    const end = ranges.length > 0 ? ranges.end(ranges.length - 1) : Number.NaN
    return Number.isFinite(end) && end > 0 ? end : Number.NaN
  }

  /** Shows a centred message over an empty stage, e.g. while the file loads or when it is text. */
  showMessage(title: string, detail = '', kind: 'info' | 'error' = 'info'): void {
    this.message.className = `vv-message show ${kind === 'error' ? 'error' : ''}`
    this.message.innerHTML = icon(kind === 'error' ? 'close' : 'film')
    const heading = el('h2')
    heading.textContent = title
    this.message.append(heading)
    if (detail) {
      const p = el('p')
      p.textContent = detail
      this.message.append(p)
    }
  }

  /** Clears the stage: no source, no message. */
  clear(): void {
    if (this.source) {
      URL.revokeObjectURL(this.source.url)
    }
    this.source = null
    this.video.removeAttribute('src')
    this.video.load()
    this.stage.classList.add('empty')
    this.setAudio(false)
    this.info.classList.remove('show')
    this.hideMessage()
    this.hideNotice()
    this.setControlsEnabled(false)
    this.renderTime()
  }

  /** Runs a keyboard shortcut; returns true when the key belonged to the player. */
  handleKey(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'SELECT' || (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range'))) {
      return false
    }
    const action = actionForKey(event)
    if (!action || (!this.source && action.kind !== 'info')) {
      return false
    }
    event.preventDefault()
    this.run(action)
    return true
  }

  dispose(): void {
    for (const dispose of this.disposers) {
      dispose()
    }
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.clear()
    this.root.remove()
  }

  private run(action: KeyAction): void {
    const v = this.video
    switch (action.kind) {
      case 'toggle-play':
        this.togglePlay()
        break
      case 'seek':
        this.seekBy(action.delta)
        break
      case 'seek-fraction': {
        const duration = this.mediaDuration()
        if (Number.isFinite(duration)) {
          v.currentTime = duration * action.fraction
        }
        break
      }
      case 'seek-start':
        v.currentTime = 0
        break
      case 'seek-end': {
        const duration = this.mediaDuration()
        if (Number.isFinite(duration)) {
          v.currentTime = Math.max(0, duration - 0.05)
        }
        break
      }
      case 'frame':
        if (!this.root.classList.contains('audio')) this.stepFrame(action.direction)
        break
      case 'volume':
        this.setVolume(v.volume + action.delta)
        this.showBadge(formatPercentOf(v.volume, this.options.locale))
        break
      case 'mute':
        this.setMuted(!v.muted)
        break
      case 'rate':
        this.setRate(stepRate(v.playbackRate, action.direction))
        break
      case 'rate-reset':
        this.setRate(1)
        break
      case 'loop':
        this.setLoop(!v.loop)
        break
      case 'info':
        this.toggleInfo()
        break
      case 'snapshot':
        if (!this.root.classList.contains('audio')) void this.snapshot()
        break
      case 'fit':
        if (!this.root.classList.contains('audio')) this.toggleFit()
        break
    }
  }

  private wire(frameBack: HTMLButtonElement, frameForward: HTMLButtonElement): void {
    const v = this.video
    const on = <K extends keyof HTMLElementEventMap>(
      target: EventTarget,
      type: K | string,
      handler: (event: Event) => void
    ) => {
      target.addEventListener(type, handler)
      this.disposers.push(() => target.removeEventListener(type, handler))
    }

    on(this.playButton, 'click', () => this.togglePlay())
    on(frameBack, 'click', () => this.stepFrame(-1))
    on(frameForward, 'click', () => this.stepFrame(1))
    on(this.muteButton, 'click', () => this.setMuted(!v.muted))
    on(this.loopButton, 'click', () => this.setLoop(!v.loop))
    on(this.snapshotButton, 'click', () => void this.snapshot())
    on(this.fitButton, 'click', () => this.toggleFit())
    on(this.infoButton, 'click', () => this.toggleInfo())
    on(this.video, 'click', () => this.togglePlay())
    on(this.cover, 'click', () => this.togglePlay())
    on(this.volume, 'input', () => this.setVolume(Number(this.volume.value)))
    on(this.rate, 'change', () => this.setRate(Number(this.rate.value)))

    on(this.seek, 'input', () => {
      this.seeking = true
      v.currentTime = Number(this.seek.value)
      this.renderTime()
    })
    on(this.seek, 'change', () => {
      this.seeking = false
    })

    on(v, 'play', () => this.renderPlayState())
    on(v, 'pause', () => this.renderPlayState())
    on(v, 'timeupdate', () => this.renderTime())
    on(v, 'seeked', () => this.renderTime())
    on(v, 'durationchange', () => this.renderTime())
    on(v, 'loadedmetadata', () => {
      this.setControlsEnabled(true)
      this.renderTime()
    })
    on(v, 'volumechange', () => this.renderVolume())
    on(v, 'ratechange', () => {
      this.rate.value = String(v.playbackRate)
      if (this.rate.value !== String(v.playbackRate)) {
        // A speed outside the list (set by the browser) still shows.
        const option = el('option')
        option.value = String(v.playbackRate)
        option.textContent = formatRate(v.playbackRate, this.options.locale)
        this.rate.append(option)
        this.rate.value = option.value
      }
    })
    on(v, 'ended', () => {
      this.renderPlayState()
      if (!v.loop) {
        this.options.onEnded?.()
      }
    })
    on(v, 'error', () => this.renderError())
    if (this.options.keyboard !== false) {
      on(window, 'keydown', (event) => {
        this.handleKey(event as KeyboardEvent)
      })
    }
  }

  private applyPrefs(): void {
    this.video.volume = this.prefs.volume
    this.video.muted = this.prefs.muted
    this.video.loop = this.prefs.loop
    this.applyRate()
    this.renderVolume()
    this.loopButton.setAttribute('aria-pressed', String(this.prefs.loop))
  }

  private applyRate(): void {
    this.video.defaultPlaybackRate = this.prefs.rate
    this.video.playbackRate = this.prefs.rate
    this.rate.value = String(this.prefs.rate)
  }

  private persist(): void {
    savePrefs(this.prefs)
  }

  private setAudio(audio: boolean): void {
    this.root.classList.toggle('audio', audio)
    this.stage.classList.toggle('audio', audio)
    this.stage.classList.remove('no-picture')
    this.coverType.textContent = audio ? (this.source?.type.replace(/^\./, '') || this.s.audio) : ''
  }

  /** Sound without a picture in a video file: the picture-only controls go, the notice says why. */
  private setNoPicture(codec: string | undefined): void {
    this.root.classList.add('audio')
    this.stage.classList.add('no-picture')
    this.showNotice(codec ? this.s.noPicture.replace('{codec}', codec) : this.s.noPictureUnknown)
  }

  private showNotice(text: string): void {
    this.notice.textContent = text
    this.notice.classList.add('show')
  }

  private hideNotice(): void {
    this.notice.textContent = ''
    this.notice.classList.remove('show')
  }

  private togglePlay(): void {
    if (!this.source) {
      return
    }
    const v = this.video
    if (v.paused || v.ended) {
      void v.play().catch(() => undefined)
      this.showFlash('play')
    } else {
      v.pause()
      this.showFlash('pause')
    }
  }

  private seekBy(delta: number): void {
    const v = this.video
    v.currentTime = seekTarget(v.currentTime, delta, this.mediaDuration())
    const amount = `${delta > 0 ? '+' : '−'}${formatNumber(Math.abs(delta), this.options.locale)}`
    this.showBadge(this.s.seekBadge.replace('{n}', amount))
  }

  private stepFrame(direction: 1 | -1): void {
    const v = this.video
    if (!this.source) {
      return
    }
    v.pause()
    const duration = this.frameDuration()
    const anchor = stepAnchor(v.currentTime, this.shownTime, this.pendingStep, duration)
    const target = frameStepTarget(anchor, duration, direction, this.mediaDuration())
    this.pendingStep = { target, anchor: Math.max(0, anchor + direction * duration) }
    v.currentTime = target
  }

  /**
   * Seconds per frame for a step: the AVI decoder's exact rate, else the container's declared
   * frame duration, else the rate measured during playback, else 30 fps.
   */
  private frameDuration(): number {
    const source = this.source
    if (source?.fps) return 1 / source.fps
    if (source?.frameDuration) return source.frameDuration
    return 1 / (this.measuredFps ?? DEFAULT_FPS)
  }

  private setVolume(value: number): void {
    const volume = clamp(value, 0, 1)
    this.video.volume = volume
    if (volume > 0 && this.video.muted) {
      this.video.muted = false
    }
    this.prefs = { ...this.prefs, volume, muted: this.video.muted }
    this.persist()
  }

  private setMuted(muted: boolean): void {
    this.video.muted = muted
    this.prefs = { ...this.prefs, muted }
    this.persist()
  }

  private setRate(rate: number): void {
    this.prefs = { ...this.prefs, rate }
    this.applyRate()
    this.persist()
    this.showBadge(formatRate(rate, this.options.locale))
  }

  private setLoop(loop: boolean): void {
    this.video.loop = loop
    this.prefs = { ...this.prefs, loop }
    this.loopButton.setAttribute('aria-pressed', String(loop))
    this.persist()
    this.showBadge(loop ? '↻ ✓' : '↻ ✕')
  }

  private toggleFit(): void {
    this.actualSize = !this.actualSize
    this.stage.classList.toggle('actual', this.actualSize)
    this.fitButton.setAttribute('aria-pressed', String(this.actualSize))
    setIcon(this.fitButton, this.actualSize ? 'fit' : 'actual', this.s.fit)
    this.showBadge(this.actualSize ? formatPercentOf(1, this.options.locale) : '⤢')
  }

  private toggleInfo(): void {
    const show = !this.info.classList.contains('show')
    this.info.classList.toggle('show', show && this.source !== null)
    this.infoButton.setAttribute('aria-pressed', String(show && this.source !== null))
    this.renderInfo()
  }

  private async snapshot(): Promise<void> {
    const v = this.video
    const files = globalThis.orca?.files
    if (!this.source || !files || !v.videoWidth) {
      return
    }
    try {
      const canvas = document.createElement('canvas')
      canvas.width = v.videoWidth
      canvas.height = v.videoHeight
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('no 2d context')
      }
      context.drawImage(v, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) {
        throw new Error('encode failed')
      }
      const result = await files.saveAs({
        suggestedName: `${baseName(this.source.name)}-${timestampForFile(v.currentTime)}.png`,
        mimeType: 'image/png',
        data: await blob.arrayBuffer()
      })
      if (result.status === 'saved') {
        this.showToast(this.s.snapshotSaved)
      }
    } catch {
      this.showToast(this.s.snapshotFailed)
    }
  }

  /**
   * Follows the frames the video presents (requestVideoFrameCallback): the frame on screen for
   * frame steps, and, while it plays at 1×, the frame rate for the info overlay (FrameRateMeter).
   */
  private watchFrames(): void {
    type FrameMeta = { mediaTime: number }
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number
    }
    if (typeof v.requestVideoFrameCallback !== 'function') {
      return
    }
    const source = this.source
    const tick = (_now: number, meta: FrameMeta) => {
      if (this.source !== source || !source) {
        return
      }
      this.shownTime = meta.mediaTime
      if (!v.paused && !source.fps && this.measuredFps === null) {
        const decoded = v.getVideoPlaybackQuality?.().totalVideoFrames
        const fps = this.meter.add(meta.mediaTime, v.playbackRate, decoded)
        if (fps !== null) {
          this.measuredFps = fps
          this.renderInfo()
        }
      }
      v.requestVideoFrameCallback?.(tick)
    }
    v.requestVideoFrameCallback(tick)
  }

  private renderPlayState(): void {
    const playing = !this.video.paused && !this.video.ended
    setIcon(this.playButton, playing ? 'pause' : 'play', playing ? this.s.pause : this.s.play)
  }

  private renderTime(): void {
    const v = this.video
    const duration = this.mediaDuration()
    this.seek.max = String(Number.isFinite(duration) ? duration : 0)
    if (!this.seeking) {
      this.seek.value = String(v.currentTime)
    }
    setFill(this.seek)
    this.time.textContent = this.source ? `${formatTime(v.currentTime)} / ${formatTime(duration)}` : '--:-- / --:--'
  }

  private renderVolume(): void {
    const v = this.video
    this.volume.value = String(v.muted ? 0 : v.volume)
    setFill(this.volume)
    const silent = v.muted || v.volume === 0
    setIcon(this.muteButton, silent ? 'muted' : 'volume', silent ? this.s.unmute : this.s.mute)
  }

  private renderInfo(): void {
    if (!this.info.classList.contains('show') || !this.source) {
      return
    }
    const v = this.video
    const rows = infoRows(
      {
        size: this.source.size,
        picture: !this.root.classList.contains('audio'),
        width: v.videoWidth,
        height: v.videoHeight,
        duration: this.mediaDuration(),
        fps: this.source.fps ? displayFps(this.source.fps) : this.measuredFps,
        type: this.source.type
      },
      this.s,
      this.options.locale
    )
    this.info.replaceChildren(
      ...rows.flatMap(([label, value]) => {
        const dt = el('dt')
        dt.textContent = label
        const dd = el('dd')
        dd.textContent = value
        return [dt, dd]
      })
    )
  }

  private renderError(): void {
    const error = this.video.error
    if (!error || !this.source) {
      return
    }
    const s = this.s
    const detail =
      error.code === MediaError.MEDIA_ERR_DECODE || error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? s.errorDecode
        : error.code === MediaError.MEDIA_ERR_NETWORK
          ? s.errorNetwork
          : s.errorGeneric
    this.showMessage(s.errorTitle, detail, 'error')
    this.setControlsEnabled(false)
  }

  private hideMessage(): void {
    this.message.className = 'vv-message'
    this.message.replaceChildren()
  }

  private setControlsEnabled(enabled: boolean): void {
    for (const control of [
      this.playButton,
      this.seek,
      this.loopButton,
      this.snapshotButton,
      this.fitButton,
      this.infoButton,
      this.rate,
      ...this.frameButtons
    ]) {
      control.disabled = !enabled
    }
  }

  private showFlash(name: IconName): void {
    this.flash.innerHTML = icon(name)
    this.pulse(this.flash, 'flash', 350)
  }

  private showBadge(text: string): void {
    this.badge.textContent = text
    this.pulse(this.badge, 'badge', 700)
  }

  private showToast(text: string): void {
    this.toast.textContent = text
    this.pulse(this.toast, 'toast', 1800)
  }

  private pulse(node: HTMLElement, key: string, ms: number): void {
    node.classList.add('show')
    const previous = this.timers.get(key)
    if (previous !== undefined) {
      clearTimeout(previous)
    }
    this.timers.set(
      key,
      window.setTimeout(() => {
        node.classList.remove('show')
        this.timers.delete(key)
      }, ms)
    )
  }
}
