// Types for avi-decoder.mjs, the Emscripten build of wasm/avi.c (see wasm/build.sh).

export interface AviDecoder {
  HEAPU8: Uint8Array
  HEAPF32: Float32Array
  UTF8ToString(ptr: number): string
  _avi_alloc(size: number): number
  _avi_free(ptr: number): void
  _avi_open(data: number, size: number): number
  _avi_close(): void
  /** 1 a video frame, 2 audio, 0 the end, below 0 an error. */
  _avi_next(): number
  _avi_has_video(): number
  _avi_has_audio(): number
  _avi_width(): number
  _avi_height(): number
  _avi_fps(): number
  _avi_channels(): number
  _avi_sample_rate(): number
  _avi_duration(): number
  _avi_video_codec(): number
  _avi_audio_codec(): number
  _avi_unsupported_codec(): number
  _avi_video_data(): number
  _avi_video_size(): number
  _avi_video_pts(): number
  _avi_audio_data(): number
  _avi_audio_frames(): number
  _avi_audio_pts(): number
  _avi_position(): number
}

export default function createAviDecoder(options?: {
  locateFile?: (path: string, prefix: string) => string
}): Promise<AviDecoder>
