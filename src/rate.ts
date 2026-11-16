// Frame rates and frame steps. Pure: no DOM, so `orca plugin test` runs it in Node.

/** Frame rates that real files use; measured and declared rates snap to the nearest one. */
export const COMMON_RATES = [
  8, 10, 12, 12.5, 15, 20, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 144, 240
] as const

/** The common rate within `tolerance` (relative) of `fps`, or null. */
export function snapFps(fps: number, tolerance = 0.001): number | null {
  if (!(fps > 0) || !Number.isFinite(fps)) {
    return null
  }
  let best: number | null = null
  for (const rate of COMMON_RATES) {
    if (Math.abs(rate - fps) <= fps * tolerance && (best === null || Math.abs(rate - fps) < Math.abs(best - fps))) {
      best = rate
    }
  }
  return best
}

/** A declared rate as the info overlay shows it: snapped (`24000/1001` → 23.976), else to 0.01. */
export function displayFps(fps: number): number {
  return snapFps(fps, 1e-4) ?? Math.round(fps * 100) / 100
}

/** Shortest span of media time a measurement needs before it counts. */
export const MIN_MEASURE_SECONDS = 1
/** Past this span, a measurement between two close common rates takes the nearer one. */
export const MAX_MEASURE_SECONDS = 6
/**
 * How far a span of presentation times can be off: Matroska rounds timestamps to 1 ms, so each
 * end of the span is within half a millisecond, plus a little for float rounding.
 */
const SPAN_ERROR_SECONDS = 0.0011
/** A jump in media time longer than this is a seek, a loop or a stall, not the next frame. */
const MAX_FRAME_GAP_SECONDS = 0.5

/**
 * Measures a video's frame rate from the presentation times of the frames shown during playback
 * at 1×, over at least a second, and snaps it to a common rate once only one fits.
 *
 * Frames the screen skips (a 60 fps clip on a busy compositor) are counted from the gaps between
 * presentation times. When every presented frame skips the same number of decoded ones (120 fps
 * on a 60 Hz screen), the decoded-frame counter of `getVideoPlaybackQuality` corrects the count.
 */
export class FrameRateMeter {
  private first = Number.NaN
  private last = Number.NaN
  private firstDecoded = Number.NaN
  private lastDecoded = Number.NaN
  private gaps: number[] = []

  /** Starts over: after a seek, a speed change or a new source. */
  reset(): void {
    this.first = this.last = this.firstDecoded = this.lastDecoded = Number.NaN
    this.gaps = []
  }

  /**
   * Adds the presentation time of a frame shown while playing; returns the frame rate once the
   * measurement is solid, else null. `decodedFrames` is `getVideoPlaybackQuality().totalVideoFrames`.
   */
  add(mediaTime: number, playbackRate: number, decodedFrames?: number): number | null {
    if (playbackRate !== 1 || !Number.isFinite(mediaTime)) {
      this.reset()
      return null
    }
    const gap = mediaTime - this.last
    if (Number.isNaN(this.last) || !(gap > 0) || gap > MAX_FRAME_GAP_SECONDS) {
      this.reset()
      this.first = mediaTime
      this.firstDecoded = decodedFrames ?? Number.NaN
    } else {
      this.gaps.push(gap)
    }
    this.last = mediaTime
    this.lastDecoded = decodedFrames ?? Number.NaN
    return this.estimate()
  }

  private estimate(): number | null {
    const span = this.last - this.first
    if (span < MIN_MEASURE_SECONDS || this.gaps.length < 8) {
      return null
    }
    const sorted = [...this.gaps].sort((a, b) => a - b)
    const typical = sorted[Math.floor(sorted.length / 2)]
    let frames = 0
    for (const gap of this.gaps) {
      frames += Math.max(1, Math.round(gap / typical))
    }
    const decoded = this.lastDecoded - this.firstDecoded
    if (decoded > 0) {
      const ratio = decoded / frames
      const whole = Math.round(ratio)
      if (whole >= 2 && Math.abs(ratio - whole) < 0.2) {
        frames *= whole
      }
    }
    const fps = frames / span
    const error = fps * (SPAN_ERROR_SECONDS / span)
    const fits = COMMON_RATES.filter((rate) => Math.abs(rate - fps) <= error)
    if (fits.length === 1) {
      return fits[0]
    }
    if (fits.length === 0) {
      // Not a common rate (variable frame rate, an odd capture): good to 0.01 after two seconds.
      return span >= 2 * MIN_MEASURE_SECONDS ? (snapFps(fps, 0.002) ?? Math.round(fps * 100) / 100) : null
    }
    return span >= MAX_MEASURE_SECONDS ? (snapFps(fps, 1) ?? fps) : null
  }
}

/** A frame step the player sent: where it seeked and the frame it is heading for. */
export type PendingStep = { target: number; anchor: number }

/**
 * The presentation time of the frame on screen, for a frame step.
 * - `shown` is the media time of the last frame the video presented (requestVideoFrameCallback),
 *   used while the playhead is inside that frame;
 * - `pending` is the previous step, used while the playhead is still where that step put it and
 *   the new frame has not been presented yet (a key held down);
 * - otherwise the playhead is placed on a grid of frames from 0.
 */
export function stepAnchor(
  currentTime: number,
  shown: number | null,
  pending: PendingStep | null,
  frameDuration: number
): number {
  if (shown !== null && currentTime >= shown - 0.001 && currentTime < shown + frameDuration + 0.001) {
    return shown
  }
  if (pending && Math.abs(currentTime - pending.target) < 1e-4) {
    return pending.anchor
  }
  return Math.floor(currentTime / frameDuration + 1e-6) * frameDuration
}

/**
 * Where to seek for the next (1) or previous (-1) frame from the frame shown at `anchor`: the
 * middle of that frame's display time, so timestamps rounded to the millisecond (Matroska) or a
 * start that is not on the frame grid never land on the frame boundary and repeat or skip one.
 */
export function frameStepTarget(anchor: number, frameDuration: number, direction: 1 | -1, duration: number): number {
  const target = anchor + (direction > 0 ? 1.5 : -0.5) * frameDuration
  const end = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY
  return Math.min(end, Math.max(0, target))
}
