// Pure helpers with no DOM and no Orca: everything here runs in Node under `orca plugin test`.

/** File suffixes the plugin claims, without the dot. Keep in step with `orca-plugin.json`. */
export const VIDEO_TYPES = ['mp4', 'm4v', 'webm', 'mov', 'mkv'] as const

/** Playback speeds offered in the speed menu and stepped through with `<` and `>`. */
export const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3] as const

/** Orca's limit for a document sent to a custom editor; larger files go through the panel. */
export const EDITOR_LIMIT_BYTES = 64 * 1024 * 1024

/** The suffix of a file name in lower case, without the dot: `clip.MP4` → `mp4`. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * A MIME type for a Blob of this file type. Chromium sniffs the container anyway, so this is a
 * hint: QuickTime files are ISO BMFF and play as `video/mp4`, Matroska through the WebM demuxer.
 */
export function mimeFor(fileType: string | undefined): string {
  switch ((fileType ?? '').replace(/^\./, '').toLowerCase()) {
    case 'mp4':
    case 'm4v':
    case 'mov':
      return 'video/mp4'
    case 'webm':
      return 'video/webm'
    case 'mkv':
      return 'video/x-matroska'
    default:
      return ''
  }
}

/** True when the panel should accept this file: a claimed suffix or any `video/*` type. */
export function isVideoFile(name: string, type = ''): boolean {
  return type.startsWith('video/') || (VIDEO_TYPES as readonly string[]).includes(extensionOf(name))
}

/** `75.5` → `1:15`, `3725` → `1:02:05`. Unknown or negative durations read `--:--`. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '--:--'
  }
  const whole = Math.floor(seconds)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** A timestamp safe for a file name: `75.25` → `00-01-15.250`. */
export function timestampForFile(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const ms = Math.round(safe * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const rest = ms % 1000
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(h)}-${two(m)}-${two(s)}.${String(rest).padStart(3, '0')}`
}

/** `1536` → `1.5 KB`. Uses 1024 steps, like Finder's "binary" sizes in Orca's file tree. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

/** `1` → `1×`, `0.25` → `0.25×`. */
export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`
}

/** The next speed in `RATES` up (`direction` 1) or down (-1); stays at the ends. */
export function stepRate(current: number, direction: 1 | -1): number {
  const rates = RATES as readonly number[]
  if (direction > 0) {
    return rates.find((rate) => rate > current + 1e-9) ?? rates[rates.length - 1]
  }
  for (let i = rates.length - 1; i >= 0; i -= 1) {
    if (rates[i] < current - 1e-9) {
      return rates[i]
    }
  }
  return rates[0]
}

/** `value` held to `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A new time after a jump, held inside the clip. Unknown durations only clamp at zero. */
export function seekTarget(current: number, delta: number, duration: number): number {
  const next = current + delta
  return Number.isFinite(duration) && duration > 0 ? clamp(next, 0, duration) : Math.max(0, next)
}

/** The base name of a file without its suffix, for snapshot names: `a/b/clip.mp4` → `clip`. */
export function baseName(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? name
  const dot = leaf.lastIndexOf('.')
  return dot > 0 ? leaf.slice(0, dot) : leaf || 'video'
}

/** An estimate of frames per second from two presented frames, rounded to a common rate. */
export function estimateFps(mediaTimeDelta: number, frameDelta: number): number | null {
  if (!(mediaTimeDelta > 0) || !(frameDelta > 0)) {
    return null
  }
  const raw = frameDelta / mediaTimeDelta
  if (raw < 1 || raw > 240) {
    return null
  }
  const common = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 120, 144, 240]
  const nearest = common.reduce((best, fps) => (Math.abs(fps - raw) < Math.abs(best - raw) ? fps : best))
  return Math.abs(nearest - raw) / raw < 0.03 ? nearest : Math.round(raw * 100) / 100
}

/** Keyboard actions of the player. */
export type KeyAction =
  | { kind: 'toggle-play' }
  | { kind: 'seek'; delta: number }
  | { kind: 'seek-fraction'; fraction: number }
  | { kind: 'seek-start' }
  | { kind: 'seek-end' }
  | { kind: 'frame'; direction: 1 | -1 }
  | { kind: 'volume'; delta: number }
  | { kind: 'mute' }
  | { kind: 'rate'; direction: 1 | -1 }
  | { kind: 'rate-reset' }
  | { kind: 'loop' }
  | { kind: 'fullscreen' }
  | { kind: 'info' }
  | { kind: 'snapshot' }
  | { kind: 'fit' }

export type KeyInput = {
  key: string
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}

/**
 * The action for a key press, or null to leave the key to Orca. Keys with Cmd, Ctrl or Alt are
 * never taken, so Orca's own shortcuts keep working inside the player.
 */
export function actionForKey(input: KeyInput): KeyAction | null {
  if (input.metaKey || input.ctrlKey || input.altKey) {
    return null
  }
  const key = input.key
  if (/^[0-9]$/.test(key)) {
    return { kind: 'seek-fraction', fraction: Number(key) / 10 }
  }
  switch (key) {
    case ' ':
    case 'k':
    case 'K':
      return { kind: 'toggle-play' }
    case 'ArrowLeft':
      return { kind: 'seek', delta: input.shiftKey ? -1 : -5 }
    case 'ArrowRight':
      return { kind: 'seek', delta: input.shiftKey ? 1 : 5 }
    case 'j':
    case 'J':
      return { kind: 'seek', delta: -10 }
    case 'l':
    case 'L':
      return { kind: 'seek', delta: 10 }
    case 'Home':
      return { kind: 'seek-start' }
    case 'End':
      return { kind: 'seek-end' }
    case ',':
      return { kind: 'frame', direction: -1 }
    case '.':
      return { kind: 'frame', direction: 1 }
    case '<':
      return { kind: 'rate', direction: -1 }
    case '>':
      return { kind: 'rate', direction: 1 }
    case '=':
      return { kind: 'rate-reset' }
    case 'ArrowUp':
      return { kind: 'volume', delta: 0.05 }
    case 'ArrowDown':
      return { kind: 'volume', delta: -0.05 }
    case 'm':
    case 'M':
      return { kind: 'mute' }
    case 'r':
    case 'R':
      return { kind: 'loop' }
    case 'f':
    case 'F':
      return { kind: 'fullscreen' }
    case 'i':
    case 'I':
      return { kind: 'info' }
    case 's':
    case 'S':
      return { kind: 'snapshot' }
    case 'z':
    case 'Z':
      return { kind: 'fit' }
    default:
      return null
  }
}
