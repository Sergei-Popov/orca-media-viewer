// Pure helpers with no DOM and no Orca: everything here runs in Node under `orca plugin test`.

/**
 * Files Orca cannot show at all ("Binary file — cannot display"): the player opens them by
 * default. Keep in step with the `media` and `media-audio` editors in `orca-plugin.json`.
 */
export const DEFAULT_TYPES = ['mkv', 'avi', 'mka', 'weba'] as const

/**
 * Files Orca already plays with its own basic viewer, without a size limit: the player is
 * offered in the tab's view toggle instead. Keep in step with the `media-plus` and
 * `media-plus-audio` editors.
 */
export const OPTION_TYPES = [
  'mp4',
  'm4v',
  'mov',
  'webm',
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'flac',
  'opus'
] as const

const AUDIO_TYPES = new Set(['mka', 'weba', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus'])

/** Playback speeds offered in the speed menu and stepped through with `<` and `>`. */
export const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3] as const

/**
 * The largest file Orca sends to a custom editor; Orca shows its own notice above it. Orca reads
 * types it has no viewer for (`.mkv`, `.avi`, `.mka`, `.weba`) through its 50 MiB preview limit,
 * and media it plays itself (`.mp4`, `.mov`, `.webm`, audio) through the 64 MiB editor bridge.
 */
export const DEFAULT_TYPE_LIMIT_BYTES = 50 * 1024 * 1024
export const OPTION_TYPE_LIMIT_BYTES = 64 * 1024 * 1024

/** Orca's size limit for a file of this type opened in Media Player. */
export function editorLimitBytes(fileType: string | undefined): number {
  return (OPTION_TYPES as readonly string[]).includes(normalizeType(fileType)) ? OPTION_TYPE_LIMIT_BYTES : DEFAULT_TYPE_LIMIT_BYTES
}

/** `.MP4` → `mp4`. */
export function normalizeType(fileType: string | undefined): string {
  return (fileType ?? '').replace(/^\./, '').toLowerCase()
}

/** The suffix of a file name in lower case, without the dot: `clip.MP4` → `mp4`. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** True for audio-only containers: the player shows a cover instead of a black frame. */
export function isAudioType(fileType: string | undefined): boolean {
  return AUDIO_TYPES.has(normalizeType(fileType))
}

/**
 * A MIME type for a Blob of this file type. Chromium sniffs the container anyway, so this is a
 * hint: QuickTime files are ISO BMFF and play as `video/mp4`, Matroska through the WebM demuxer.
 */
export function mimeFor(fileType: string | undefined): string {
  switch (normalizeType(fileType)) {
    case 'mp4':
    case 'm4v':
    case 'mov':
      return 'video/mp4'
    case 'webm':
      return 'video/webm'
    case 'mkv':
      return 'video/x-matroska'
    case 'mka':
      return 'audio/x-matroska'
    case 'weba':
      return 'audio/webm'
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    case 'm4a':
      return 'audio/mp4'
    case 'aac':
      return 'audio/aac'
    case 'ogg':
    case 'oga':
    case 'opus':
      return 'audio/ogg'
    case 'flac':
      return 'audio/flac'
    default:
      return ''
  }
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

/** Formats a number for Orca's UI language, without grouping: `1.5` → `1,5` in Russian. */
export function formatNumber(value: number, locale: string | undefined, maxDigits = 2, minDigits = 0): string {
  const options: Intl.NumberFormatOptions = { maximumFractionDigits: maxDigits, minimumFractionDigits: minDigits, useGrouping: false }
  try {
    return new Intl.NumberFormat(locale || 'en', options).format(value)
  } catch {
    return new Intl.NumberFormat('en', options).format(value)
  }
}

/** `0.5` → `50%` (`50 %` in Russian). */
export function formatPercentOf(fraction: number, locale: string | undefined): string {
  const options: Intl.NumberFormatOptions = { style: 'percent', maximumFractionDigits: 0 }
  try {
    return new Intl.NumberFormat(locale || 'en', options).format(fraction)
  } catch {
    return new Intl.NumberFormat('en', options).format(fraction)
  }
}

/** Size units from bytes up, as the UI language writes them. */
export const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * `1536` → `1.5 KB` (`1,5 КБ` with Russian units and locale). Uses 1024 steps, like Finder's
 * "binary" sizes in Orca's file tree.
 */
export function formatBytes(bytes: number, units: readonly string[] = BYTE_UNITS, locale?: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—'
  }
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${formatNumber(value, locale, digits, digits)} ${units[unit]}`
}

/** `1` → `1×`, `0.25` → `0.25×` (`0,25×` in Russian). */
export function formatRate(rate: number, locale?: string): string {
  return `${formatNumber(rate, locale)}×`
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

/**
 * Seconds kept clear of the end of a file whose duration the player had to find (a Matroska or
 * WebM file that declares none): Chromium can stall for good on a seek into its last second.
 */
export const PROBED_END_MARGIN = 1

/**
 * The latest time a seek may reach: the duration, or a second before it when the file declared
 * no duration (`probed`). A probed file no longer than that second is not held back.
 */
export function seekLimit(duration: number, probed: boolean): number {
  return probed && Number.isFinite(duration) && duration > PROBED_END_MARGIN ? duration - PROBED_END_MARGIN : duration
}

/** Where `End` goes: just before the last frame, but not past seekLimit. */
export function endTarget(duration: number, probed: boolean): number {
  return Math.min(Math.max(0, duration - 0.05), seekLimit(duration, probed))
}

/** The base name of a file without its suffix, for snapshot names: `a/b/clip.mp4` → `clip`. */
export function baseName(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? name
  const dot = leaf.lastIndexOf('.')
  return dot > 0 ? leaf.slice(0, dot) : leaf || 'video'
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
  | { kind: 'info' }
  | { kind: 'snapshot' }
  | { kind: 'fit' }

export type KeyInput = {
  key: string
  /** The physical key (`KeyM`, `Comma`, `Digit5`), for layouts whose letters are not Latin. */
  code?: string
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}

/** The Latin key each shortcut's physical key types on a US layout. */
const CODE_KEYS: Record<string, string> = {
  KeyK: 'k',
  KeyJ: 'j',
  KeyL: 'l',
  KeyM: 'm',
  KeyR: 'r',
  KeyI: 'i',
  KeyS: 's',
  KeyZ: 'z',
  Comma: ',',
  Period: '.'
}

/**
 * The action for a key press, or null to leave the key to Orca. Keys with Cmd, Ctrl or Alt are
 * never taken, so Orca's own shortcuts keep working inside the player.
 *
 * A layout that does not type Latin letters (Russian ЙЦУКЕН and others) puts other characters on
 * the shortcut keys, so an unknown character falls back to the physical key (`event.code`): `ь` on
 * the M key mutes, `ю` on the period key steps a frame. A Latin character keeps its own meaning,
 * so Dvorak or AZERTY users get the letter they typed, and digits fall back only without Shift
 * (AZERTY types `&` on the 1 key).
 */
export function actionForKey(input: KeyInput): KeyAction | null {
  if (input.metaKey || input.ctrlKey || input.altKey) {
    return null
  }
  const direct = actionForCharacter(input.key, input.shiftKey === true)
  // Named keys (`ArrowLeft`, `Dead`, `Process`) are never remapped; only a typed character is.
  if (direct || !input.code || input.key.length !== 1) {
    return direct
  }
  const digit = /^Digit([0-9])$/.exec(input.code)
  if (digit) {
    return input.shiftKey ? null : actionForCharacter(digit[1], false)
  }
  const latin = CODE_KEYS[input.code]
  if (!latin || /^[A-Za-z]$/.test(input.key)) {
    return null
  }
  const key = input.shiftKey && latin === ',' ? '<' : input.shiftKey && latin === '.' ? '>' : latin
  return actionForCharacter(key, input.shiftKey === true)
}

function actionForCharacter(key: string, shiftKey: boolean): KeyAction | null {
  if (/^[0-9]$/.test(key)) {
    return { kind: 'seek-fraction', fraction: Number(key) / 10 }
  }
  switch (key) {
    case ' ':
    case 'k':
    case 'K':
      return { kind: 'toggle-play' }
    case 'ArrowLeft':
      return { kind: 'seek', delta: shiftKey ? -1 : -5 }
    case 'ArrowRight':
      return { kind: 'seek', delta: shiftKey ? 1 : 5 }
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

/** What the file info overlay knows about the loaded media. */
export type InfoFacts = {
  /** The file's size in bytes. */
  size: number
  /** The player shows a picture; audio (and video whose codec does not play) has no picture rows. */
  picture: boolean
  /** The picture's size; 0 when it is not known yet. */
  width: number
  height: number
  /** In seconds; NaN until the metadata is in. */
  duration: number
  /** Frames per second, declared (AVI) or measured during playback, or null until it is known. */
  fps: number | null
  /** The file type, e.g. `.mkv`, or '' when Orca did not send one. */
  type: string
}

/** The labels, units and fallbacks the info overlay needs, from `Strings`. */
export type InfoLabels = {
  infoSize: string
  infoResolution: string
  infoDuration: string
  infoFps: string
  infoFpsPending: string
  infoType: string
  unknown: string
  sizeUnits: readonly string[]
}

/**
 * The rows of the file info overlay, as [label, value]. There is no file name row: Orca never
 * tells a custom editor the file's name or path, and a made-up name would read as the real one.
 */
export function infoRows(facts: InfoFacts, s: InfoLabels, locale?: string): Array<[string, string]> {
  const rows: Array<[string, string]> = [[s.infoSize, formatBytes(facts.size, s.sizeUnits, locale)]]
  if (facts.picture) {
    rows.push([s.infoResolution, facts.width && facts.height ? `${facts.width} × ${facts.height}` : s.unknown])
  }
  rows.push([s.infoDuration, formatTime(facts.duration)])
  if (facts.picture) {
    rows.push([s.infoFps, facts.fps ? formatNumber(facts.fps, locale, 3) : `— (${s.infoFpsPending})`])
  }
  rows.push([s.infoType, facts.type || s.unknown])
  return rows
}
