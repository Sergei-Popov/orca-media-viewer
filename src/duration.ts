// Finds the duration of a WebM or Matroska file that declares none (a browser recording, a live
// capture, an unfinished file): Chromium reports Infinity for it until playback reaches the end,
// so the seek bar, `End` and 0–9 would not work. Pure apart from the media element it is handed,
// so `orca plugin test` drives it with a fake one.

import type { Track } from './container'

/** The part of a media element the probe uses: it seeks and listens, and never plays. */
export type ProbeMedia = {
  readonly duration: number
  currentTime: number
  readonly paused: boolean
  /** Width of the decoded picture; 0 when Chromium plays no video stream. */
  readonly videoWidth: number
  pause(): void
  addEventListener(type: ProbeEvent, listener: () => void): void
  removeEventListener(type: ProbeEvent, listener: () => void): void
}

export type ProbeEvent = 'durationchange' | 'seeked' | 'error'

export type ProbeOptions = {
  /** Video frames the element has decoded so far (`getVideoPlaybackQuality().totalVideoFrames`). */
  decodedFrames?: () => number
  /** Aborted when another source replaces this one: the probe then leaves the element alone. */
  signal?: AbortSignal
  /** How long the seek past the end may take to answer. */
  seekTimeoutMs?: number
  /** How long after the probe a frame of a video may take to decode before the probe is undone. */
  pictureTimeoutMs?: number
}

/**
 * The one seek, far past the end: Chromium reads the file to its end, so it learns the duration.
 * Never an ordinary seek first: on H.264 Matroska without Cues Chromium then decodes no picture.
 */
export const FAR_PROBE_SECONDS = 1e101
export const PROBE_TIMEOUT_MS = 5000
export const PICTURE_TIMEOUT_MS = 2000

/**
 * - `declared`: the file declares its duration; nothing was done.
 * - `found` / `unknown`: the probe seeked, then put the playhead back at 0, with or without a duration.
 * - `fallback`: a media error during the probe, or no video frame decoded after it: the caller opens
 *   the file again without a probe, as 0.3.0 played it.
 * - `aborted`: another source replaced this one.
 */
export type ProbeResult = 'declared' | 'found' | 'unknown' | 'fallback' | 'aborted'

/** Matroska CodecIDs whose files Chromium stops decoding after a seek when they lack Cues. */
const NO_PROBE_VIDEO_CODECS = ['V_MPEG4/ISO/AVC', 'V_MPEGH/ISO/HEVC']
const MATROSKA_TYPES = ['mkv', 'mka', 'webm', 'weba']

/**
 * Whether a file whose duration is missing may be probed: not a Matroska or WebM file with H.264
 * or HEVC video (a pipe, a crashed recording, MediaRecorder's H.264). Chromium shows no picture
 * or fails to decode such a file after a seek, so it plays without a duration, as in 0.3.0.
 */
export function probesDuration(fileType: string, tracks: readonly Track[]): boolean {
  return !(
    MATROSKA_TYPES.includes(fileType) &&
    tracks.some((track) => track.kind === 'video' && NO_PROBE_VIDEO_CODECS.includes(track.codec))
  )
}

/**
 * Finds a missing duration with one seek past the end, then puts the playhead back at 0, keeps
 * the element paused and checks that a video still decodes a frame. A file that declares its
 * duration is not touched.
 */
export async function findDuration(media: ProbeMedia, options: ProbeOptions = {}): Promise<ProbeResult> {
  if (Number.isFinite(media.duration)) {
    return 'declared'
  }
  const { decodedFrames, signal, seekTimeoutMs = PROBE_TIMEOUT_MS, pictureTimeoutMs = PICTURE_TIMEOUT_MS } = options
  const wasPaused = media.paused
  const far = await seekAndWait(media, FAR_PROBE_SECONDS, seekTimeoutMs, signal, (seeked) => seeked || Number.isFinite(media.duration))
  if (far !== 'done') {
    return far === 'error' ? 'fallback' : 'aborted'
  }
  const found = Number.isFinite(media.duration)
  // A video must still decode a frame after the probe. A seek to where the playhead already is
  // decodes nothing new: then any frame counts.
  const video = decodedFrames !== undefined && media.videoWidth > 0
  const before = video && media.currentTime !== 0 ? decodedFrames() : 0
  const pictured = () => !video || decodedFrames() > before
  const restored = seekAndWait(media, 0, pictureTimeoutMs, signal, (seeked) => seeked && pictured())
  if (wasPaused && !media.paused) {
    media.pause()
  }
  const back = await restored
  if (back !== 'done') {
    return back === 'error' ? 'fallback' : 'aborted'
  }
  return pictured() ? (found ? 'found' : 'unknown') : 'fallback'
}

/**
 * Seeks to `time` and waits until `done(seeked)` holds (checked on `durationchange`, `seeked` and
 * every 50 ms) or the timeout passes: `done`. `error` on a media error, `aborted` on the signal.
 */
function seekAndWait(
  media: ProbeMedia,
  time: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  done: (seeked: boolean) => boolean
): Promise<'done' | 'error' | 'aborted'> {
  if (signal?.aborted) {
    return Promise.resolve('aborted')
  }
  return new Promise((resolve) => {
    let seeked = false
    const finish = (outcome: 'done' | 'error' | 'aborted') => {
      clearTimeout(timer)
      clearInterval(poller)
      media.removeEventListener('durationchange', check)
      media.removeEventListener('seeked', onSeeked)
      media.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    const check = () => {
      if (done(seeked)) finish('done')
    }
    const onSeeked = () => {
      seeked = true
      check()
    }
    const onError = () => finish('error')
    const onAbort = () => finish('aborted')
    const timer = setTimeout(() => finish('done'), timeoutMs)
    const poller = setInterval(check, 50)
    media.addEventListener('durationchange', check)
    media.addEventListener('seeked', onSeeked)
    media.addEventListener('error', onError)
    signal?.addEventListener('abort', onAbort)
    media.currentTime = time
  })
}
