// Turns an AVI file into an MP4 that Chromium plays, inside a Web Worker of the editor frame.
//
// FFmpeg built to WebAssembly (vendor/ffmpeg, from wasm/avi.c) demuxes the AVI and decodes its
// video (Xvid, DivX, MPEG-4, H.264, MJPEG, MPEG-1/2…) and sound (MP3, AC3, AAC, PCM…). WebCodecs
// re-encodes them, in hardware where the system has it, and mp4-muxer writes the MP4. Nothing
// leaves the frame: no network, no files.

import createAviDecoder, { type AviDecoder } from '../../vendor/ffmpeg/avi-decoder.mjs'
import { ArrayBufferTarget, Muxer } from '../../vendor/mp4-muxer/mp4-muxer.mjs'
import {
  AUDIO_CANDIDATES,
  AUDIO_SAMPLE_RATE,
  audioBitrate,
  frameColorSpace,
  frameSizeText,
  keyFrameInterval,
  muxerVideoTrack,
  openErrorCode,
  toMicroseconds,
  VIDEO_CANDIDATES,
  videoBitrate,
  type AviErrorCode
} from './plan'

/** What the editor sends: the AVI file's bytes (transferred). */
export type AviRequest = { bytes: ArrayBuffer }

/** What the worker sends back. */
export type AviMessage =
  | { type: 'progress'; value: number }
  | {
      type: 'done'
      buffer: ArrayBuffer
      info: {
        video: string
        audio: string
        width: number
        height: number
        fps: number
        audioOnly: boolean
        /** False when the file has a sound stream but no sound came out of it (an unknown codec). */
        audioDelivered: boolean
      }
    }
  | { type: 'error'; code: AviErrorCode; codec?: string; message?: string }

class AviError extends Error {
  constructor(
    readonly code: AviErrorCode,
    readonly codec?: string
  ) {
    super(code)
  }
}

const scope = globalThis as unknown as {
  postMessage(message: AviMessage, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<AviRequest>) => void) | null
}

function post(message: AviMessage, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer)
}

type VideoChoice = { config: VideoEncoderConfig; mux: 'avc' | 'vp9' }
type AudioChoice = { config: AudioEncoderConfig; mux: 'opus' | 'aac' }

async function chooseVideo(width: number, height: number, fps: number): Promise<VideoChoice | null> {
  if (typeof VideoEncoder === 'undefined') {
    return null
  }
  for (const candidate of VIDEO_CANDIDATES) {
    for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
      const config: VideoEncoderConfig = {
        codec: candidate.codec,
        width,
        height,
        bitrate: videoBitrate(width, height, fps),
        framerate: fps,
        hardwareAcceleration,
        ...(candidate.avc ? { avc: { format: 'avc' as const } } : {})
      }
      try {
        const support = await VideoEncoder.isConfigSupported(config)
        if (support.supported) {
          return { config: support.config ?? config, mux: candidate.mux }
        }
      } catch {
        // an unknown codec string throws on some versions; try the next one
      }
    }
  }
  return null
}

async function chooseAudio(channels: number): Promise<AudioChoice | null> {
  if (typeof AudioEncoder === 'undefined') {
    return null
  }
  for (const candidate of AUDIO_CANDIDATES) {
    const config: AudioEncoderConfig = {
      codec: candidate.codec,
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfChannels: channels,
      bitrate: audioBitrate(channels)
    }
    try {
      const support = await AudioEncoder.isConfigSupported(config)
      if (support.supported) {
        return { config: support.config ?? config, mux: candidate.mux }
      }
    } catch {
      // try the next one
    }
  }
  return null
}

/** Waits while an encoder holds more than `limit` inputs, so memory stays flat. */
async function backpressure(encoder: VideoEncoder | AudioEncoder, limit: number): Promise<void> {
  while (encoder.encodeQueueSize > limit) {
    await new Promise<void>((resolve) => encoder.addEventListener('dequeue', () => resolve(), { once: true }))
  }
}

async function loadDecoder(): Promise<AviDecoder> {
  return createAviDecoder({
    locateFile: (path) => new URL(`../../vendor/ffmpeg/${path}`, import.meta.url).href
  })
}

async function transcode(bytes: ArrayBuffer): Promise<void> {
  const m = await loadDecoder()
  const size = bytes.byteLength
  const ptr = m._avi_alloc(size)
  if (!ptr) {
    throw new AviError('memory')
  }
  m.HEAPU8.set(new Uint8Array(bytes), ptr)
  try {
    const opened = m._avi_open(ptr, size)
    if (opened < 0) {
      const code = openErrorCode(opened)
      throw new AviError(code, code === 'video-codec' ? m.UTF8ToString(m._avi_unsupported_codec()) : undefined)
    }
    const hasVideo = m._avi_has_video() === 1
    const hasAudio = m._avi_has_audio() === 1
    const width = m._avi_width()
    const height = m._avi_height()
    const fps = m._avi_fps()
    const channels = m._avi_channels()

    const video = hasVideo ? await chooseVideo(width, height, fps) : null
    if (hasVideo && !video) {
      // When the encoders take an ordinary size, it is this frame size that they refuse.
      const ordinary = typeof VideoEncoder !== 'undefined' && (await chooseVideo(640, 360, fps)) !== null
      throw ordinary ? new AviError('too-large', frameSizeText(width, height)) : new AviError('encoder')
    }
    const audio = hasAudio ? await chooseAudio(channels) : null
    if (!video && !audio) {
      throw new AviError(hasAudio ? 'encoder' : 'no-streams')
    }

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: video ? muxerVideoTrack(video.mux, width, height) : undefined,
      audio: audio ? { codec: audio.mux, numberOfChannels: channels, sampleRate: AUDIO_SAMPLE_RATE } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'cross-track-offset'
    })

    let failure: unknown = null
    const videoEncoder = video
      ? new VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error: (error) => {
            failure = error
          }
        })
      : null
    videoEncoder?.configure(video!.config)
    const audioEncoder = audio
      ? new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
          error: (error) => {
            failure = error
          }
        })
      : null
    audioEncoder?.configure(audio!.config)

    const keyEvery = keyFrameInterval(fps)
    const frameDuration = Math.round(1_000_000 / (fps > 0 ? fps : 25))
    const colorSpace = frameColorSpace(height)
    let frames = 0
    let audioChunks = 0
    let lastProgress = 0

    for (;;) {
      if (failure) {
        throw failure
      }
      const next = m._avi_next()
      if (next === 0) {
        break
      }
      if (next < 0) {
        throw new AviError('failed')
      }
      if (next === 1 && videoEncoder) {
        const start = m._avi_video_data()
        // Copy out: the WebAssembly heap can grow (and move) on the next call.
        const data = m.HEAPU8.slice(start, start + m._avi_video_size())
        const frame = new VideoFrame(data, {
          format: 'I420',
          codedWidth: width,
          codedHeight: height,
          timestamp: toMicroseconds(m._avi_video_pts()),
          duration: frameDuration,
          ...(colorSpace ? { colorSpace } : {})
        })
        videoEncoder.encode(frame, { keyFrame: frames % keyEvery === 0 })
        frame.close()
        frames += 1
        await backpressure(videoEncoder, 8)
      } else if (next === 2 && audioEncoder) {
        const count = m._avi_audio_frames()
        const start = m._avi_audio_data() >> 2
        const samples = m.HEAPF32.slice(start, start + count * channels)
        const data = new AudioData({
          format: 'f32',
          sampleRate: AUDIO_SAMPLE_RATE,
          numberOfFrames: count,
          numberOfChannels: channels,
          timestamp: toMicroseconds(m._avi_audio_pts()),
          data: samples
        })
        audioEncoder.encode(data)
        data.close()
        audioChunks += 1
        await backpressure(audioEncoder, 32)
      }
      const now = performance.now()
      if (now - lastProgress > 100) {
        lastProgress = now
        post({ type: 'progress', value: m._avi_position() })
      }
    }

    await videoEncoder?.flush()
    await audioEncoder?.flush()
    if (failure) {
      throw failure
    }
    videoEncoder?.close()
    audioEncoder?.close()
    // Nothing decoded at all (a damaged or cut-off file): an empty MP4 would play as 0:00.
    if ((video && frames === 0) || (!video && audioChunks === 0)) {
      throw new AviError('failed')
    }
    muxer.finalize()
    const buffer = muxer.target.buffer
    post(
      {
        type: 'done',
        buffer,
        info: {
          video: m.UTF8ToString(m._avi_video_codec()),
          audio: audio ? m.UTF8ToString(m._avi_audio_codec()) : '',
          width,
          height,
          fps,
          audioOnly: !video,
          audioDelivered: audioChunks > 0
        }
      },
      [buffer]
    )
  } finally {
    m._avi_close()
    m._avi_free(ptr)
  }
}

scope.onmessage = (event) => {
  transcode(event.data.bytes).catch((error: unknown) => {
    if (error instanceof AviError) {
      post({ type: 'error', code: error.code, codec: error.codec })
    } else {
      post({ type: 'error', code: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  })
}
