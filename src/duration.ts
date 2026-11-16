// Finds the duration of a WebM or Matroska file that declares none (a browser recording, a pipe,
// an unfinished capture): Chromium reports Infinity for it until playback reaches the end, so the
// seek bar, `End` and 0–9 would not work. Pure apart from the media element it is handed, so
// `orca plugin test` drives it with a fake one.

/** The part of a media element the probe uses: it seeks and listens, and never plays. */
export type ProbeMedia = {
  readonly duration: number
  currentTime: number
  readonly paused: boolean
  pause(): void
  addEventListener(type: 'durationchange' | 'seeked', listener: () => void): void
  removeEventListener(type: 'durationchange' | 'seeked', listener: () => void): void
}

/** The first, ordinary seek: on it Chromium finds the duration of a piped Matroska file. */
export const NEAR_PROBE_SECONDS = 1
/**
 * The second seek, far past the end, when the first did not find the duration (MediaRecorder
 * WebM, live Matroska): Chromium scans the file to its end. Only as a fallback, because after it
 * Chromium leaves later seeks in a piped H.264 + AAC Matroska file stuck for good.
 */
export const FAR_PROBE_SECONDS = 1e101
/** How long each seek may take to answer. */
export const PROBE_TIMEOUT_MS = 5000

/** How the duration was found: declared by the file, by the first seek, by the far seek, or not at all. */
export type ProbeResult = 'declared' | 'near' | 'far' | 'unknown'

/**
 * Finds a missing duration with as little seeking as it takes, then puts the playhead back at 0
 * and keeps the element paused. A file that declares its duration is not touched.
 */
export async function findDuration(media: ProbeMedia, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  if (Number.isFinite(media.duration)) {
    return 'declared'
  }
  const wasPaused = media.paused
  let result: ProbeResult = 'unknown'
  if (await seekForDuration(media, NEAR_PROBE_SECONDS, timeoutMs)) {
    result = 'near'
  } else if (await seekForDuration(media, FAR_PROBE_SECONDS, timeoutMs)) {
    result = 'far'
  }
  media.currentTime = 0
  if (wasPaused && !media.paused) {
    media.pause()
  }
  return result
}

/** Seeks to `time` and waits for a finite duration, the end of the seek or the timeout; true once the duration is known. */
function seekForDuration(media: ProbeMedia, time: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      media.removeEventListener('durationchange', changed)
      media.removeEventListener('seeked', finish)
      resolve(Number.isFinite(media.duration))
    }
    const changed = () => {
      if (Number.isFinite(media.duration)) finish()
    }
    const timer = setTimeout(finish, timeoutMs)
    media.addEventListener('durationchange', changed)
    media.addEventListener('seeked', finish)
    media.currentTime = time
  })
}
