// What the AVI tab says when a file does not convert, or converts without its sound. Pure, so
// `orca plugin test` checks every message in Node.

import { soundFormatName, type Track } from '../container'
import type { Strings } from '../i18n'
import { BUILT_IN_VIDEO_DECODERS, type AviErrorCode } from './plan'

/** The parts of a failed conversion the message needs. */
export type AviFailure = { code: AviErrorCode; codec?: string }

/**
 * The text for a conversion that failed. `streams` are the AVI header's streams (readAviStreams):
 * they name the sound codec of a file that has only sound the decoder cannot read.
 */
export function aviErrorText(failure: AviFailure | null, s: Strings, streams: Track[] = []): string {
  switch (failure?.code) {
    case 'video-codec':
      // The decoder names the codec of the stream it could not open. One that is built in means
      // a damaged header or stream, not a codec the build lacks.
      if (failure.codec && BUILT_IN_VIDEO_DECODERS.includes(failure.codec)) {
        return s.aviDamaged.replace('{codec}', failure.codec)
      }
      return s.aviCodec.replace('{codec}', failure.codec || '?')
    case 'encoder':
      return s.aviEncoder
    case 'too-large':
      return s.aviTooLarge.replace('{size}', failure.codec || '?')
    case 'not-avi':
      return s.aviNotAvi
    case 'no-streams': {
      const sound = droppedAviSound(streams)
      return sound ? s.aviSoundCodec.replace('{codec}', sound) : s.aviNoStreams
    }
    case 'memory':
      return s.aviMemory
    default:
      return s.aviFailed
  }
}

/** The AVI's first sound stream, named (`WMA`), or null when it has none. */
export function droppedAviSound(streams: Track[]): string | null {
  const sound = streams.find((track) => track.kind === 'audio')
  return sound ? soundFormatName(sound.codec) : null
}
