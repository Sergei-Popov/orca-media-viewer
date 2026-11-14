// Pure helpers for AVI playback: no DOM, no WebCodecs, no WebAssembly, so `orca plugin test` runs
// them in Node. The worker (worker.ts) decodes AVI with FFmpeg built to WebAssembly and re-encodes
// it with WebCodecs into an MP4 that Chromium plays; these pick its settings.

/** A WebCodecs video codec to try, and how mp4-muxer names it. Earlier entries win. */
export type VideoCandidate = { codec: string; mux: 'avc' | 'vp9'; avc: boolean }

/**
 * H.264 first: macOS and Windows encode it in hardware. High, then Main, then Baseline at level
 * 5.1 (up to 4096×2304), and VP9 as the software fallback that Chromium always has.
 */
export const VIDEO_CANDIDATES: readonly VideoCandidate[] = [
  { codec: 'avc1.640033', mux: 'avc', avc: true },
  { codec: 'avc1.4d0033', mux: 'avc', avc: true },
  { codec: 'avc1.420033', mux: 'avc', avc: true },
  { codec: 'vp09.00.51.08', mux: 'vp9', avc: false }
]

/** Audio codecs to try: Opus (always in Chromium), then AAC. */
export const AUDIO_CANDIDATES: readonly { codec: string; mux: 'opus' | 'aac' }[] = [
  { codec: 'opus', mux: 'opus' },
  { codec: 'mp4a.40.2', mux: 'aac' }
]

export const AUDIO_SAMPLE_RATE = 48_000

/**
 * A video bitrate that keeps the picture close to the source: about 0.1 bit per pixel per frame,
 * between 1 and 16 Mbit/s. AVI sources are usually low-bitrate MPEG-4, so this is generous.
 */
export function videoBitrate(width: number, height: number, fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? Math.min(fps, 120) : 25
  const raw = width * height * safeFps * 0.1
  return Math.round(Math.min(16_000_000, Math.max(1_000_000, raw)))
}

/** A keyframe every two seconds, so seeking in the player stays quick. */
export function keyFrameInterval(fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 25
  return Math.max(1, Math.round(safeFps * 2))
}

/** Bitrate for the re-encoded sound. */
export function audioBitrate(channels: number): number {
  return channels >= 2 ? 160_000 : 96_000
}

/** Error codes the worker reports; see aviErrorText. */
export type AviErrorCode =
  | 'not-avi'
  | 'no-streams'
  | 'video-codec'
  | 'encoder'
  | 'memory'
  | 'failed'

/** The worker's code for a negative result of avi_open (see wasm/avi.c). */
export function openErrorCode(result: number): AviErrorCode {
  switch (result) {
    case -2:
      return 'not-avi'
    case -3:
      return 'no-streams'
    case -4:
      return 'video-codec'
    default:
      return 'failed'
  }
}

/** `0.4231` → `42 %`; out-of-range or unknown progress is held to 0–100. */
export function formatPercent(fraction: number): string {
  const value = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  return `${Math.floor(value * 100)} %`
}

/** Presentation times in microseconds that never go backwards, for VideoFrame and AudioData. */
export function toMicroseconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1_000_000) : 0
}
