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

/** Error codes the worker reports; see aviErrorText in messages.ts. */
export type AviErrorCode =
  | 'not-avi'
  | 'no-streams'
  | 'video-codec'
  | 'encoder'
  | 'too-large'
  | 'memory'
  | 'failed'

/**
 * The video decoders built into vendor/ffmpeg (DECODERS in wasm/build.sh, listed in
 * vendor/ffmpeg/BUILD-INFO). When the decoder cannot open one of these, the codec is supported
 * and the file is damaged.
 */
export const BUILT_IN_VIDEO_DECODERS: readonly string[] = [
  'mpeg4',
  'msmpeg4v1',
  'msmpeg4v2',
  'msmpeg4v3',
  'h263',
  'h264',
  'mjpeg',
  'mpeg1video',
  'mpeg2video',
  'rawvideo'
]

/**
 * AVI sound format tags the decoder reads: FFmpeg 7.1.1's tags (libavformat/riff.c) for the sound
 * decoders in vendor/ffmpeg/BUILD-INFO, that is PCM, MS and IMA ADPCM, MP2, MP3, AAC and AC3.
 * Sound in one of these that gives nothing is damaged, not unsupported.
 */
export const BUILT_IN_SOUND_TAGS: readonly number[] = [
  0x0001, 0x0002, 0x0003, 0x0011, 0x0050, 0x0055, 0x0069, 0x00ff, 0x1600, 0x2000, 0x4143, 0x706d, 0xa106
]

/**
 * The muxer's video track. It has no `frameRate`: mp4-muxer rejects one that is not a whole
 * number (23.976, 29.97, 12.5) and otherwise keeps its own 57600 timescale, which holds the
 * microsecond timestamps of any rate; a timescale of the rounded rate would shift 23.976 frames.
 */
export function muxerVideoTrack(codec: 'avc' | 'vp9', width: number, height: number): { codec: 'avc' | 'vp9'; width: number; height: number } {
  return { codec, width, height }
}

/** BT.601 as WebCodecs names it: what SD MPEG-4, DivX, Xvid and MJPEG video uses. */
export const BT601 = { matrix: 'smpte170m', primaries: 'smpte170m', transfer: 'smpte170m', fullRange: false } as const

/**
 * FourCCs of the video codecs that carry no colour description, so SD video in them is BT.601:
 * FFmpeg 7.1.1's tags (libavformat/riff.c) for the decoders mpeg4, msmpeg4v1–3, h263, mjpeg,
 * mpeg1video and rawvideo, in upper case because the AVI demuxer matches them in any case. The
 * empty one is uncompressed RGB (BI_RGB), whose stream header names no codec or says `DIB `.
 * H.264 and MPEG-2 are not here: their streams can say which colours they use.
 */
const NO_COLOUR_DESCRIPTION: ReadonlySet<string> = new Set(
  [
    // MPEG-4 Part 2: Xvid, DivX 4/5 and others
    'FMP4 DIVX DX50 XVID MP4S M4S2 ZMP4 DIV1 BLZ0 MP4V UMP4 WV1F SEDG RMP4 3IV2 WAWV FFDS FVFW DCOD',
    'MVXM PM4V SMP4 DXGM VIDM M4T3 GEOX G264 HDX4 DM4V DMK2 DYM4 DIGI EPHV EM4A M4CC SN40 VSPX ULDX',
    'GEOV SIPP SM4V XVIX DREX QMP4 PLV1 GLV4 GMP4 MNM4 GTM4',
    // MS MPEG-4 v1–3: DivX 3
    'MPG4 MP41 MP42 DIV2 MP43 DIV3 MPG3 DIV5 DIV6 DIV4 DVX3 AP41 COL1 COL0',
    // H.263
    'H263 X263 T263 L263 VX1K ZYGO M263 LSVM U263 VSM4 I263',
    // Motion JPEG
    'MJPG MSC2 LJPG DMB1 MJPA JR24 JPGL JPEG IJPG ACDV QIVG SLMJ CJPG IJLV MVJP AVI1 AVI2 MTSJ ZJPG MMJP',
    // MPEG-1
    'MPG1 PIM1 BW10 XMPG',
    // Raw video
    'I420 YUY2 Y422 V422 YUNV UYNV UYNY UYV1 2VU1 2VUY YUVS YUV2 P422 YV12 YV16 YV24 UYVY VYUY IYUV',
    'AYUV Y800 Y8 HDYC YVU9 VDTZ Y411 NV12 NV21 Y41B Y42B YUV9 AUV2 YVYU YUYV I410 I411 I422 I440 I444',
    'J420 J422 J440 J444 YUVA I40A I42A RGB2 RV15 RV16 RV24 RV32 RGBA AV32 GREY I09L I09B I29L I29B',
    'I49L I49B I0AL I0AB I2AL I2AB I4AL I4AB I4FL I4FB I0CL I0CB I2CL I2CB I4CL I4CB I0FL I0FB DIB'
  ]
    .join(' ')
    .split(' ')
    .concat([''])
)

/**
 * The colour space to tag the decoded frames with. The decoder hands over I420 planes with no
 * colour description, and WebCodecs would call them BT.709. SD video (under 720 lines) in a codec
 * that has no colour description is BT.601, so it is tagged that way and the MP4's colour box
 * says so. `codec` is the AVI's video stream as readAviStreams names it (`fourcc:XVID`). H.264
 * and MPEG-2 keep WebCodecs' tag, as in 0.3.0, and so does HD.
 */
export function frameColorSpace(height: number, codec: string): typeof BT601 | undefined {
  const fourcc = codec.replace(/^fourcc:/, '').trim().toUpperCase()
  return height > 0 && height < 720 && NO_COLOUR_DESCRIPTION.has(fourcc) ? BT601 : undefined
}

/** `1920`, `1080` → `1920 × 1080`, for the 'too-large' message. */
export function frameSizeText(width: number, height: number): string {
  return `${width} × ${height}`
}

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
