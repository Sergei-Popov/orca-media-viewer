// The custom editor: Orca opens a media file in a main editor tab here — from the file tree, a file
// link in a chat, or `orca file open` — and sends its bytes. Orca keeps larger files out of custom
// editors and shows its own notice instead: over 50 MiB for .mkv, .avi, .mka and .weba, over
// 64 MiB for .mp4, .mov, .webm and audio (editorLimitBytes in format.ts). The player never edits,
// so Orca never saves the tab; an outside write reloads the media at the same position.

import { AviConversionError, convertAvi, type AviConversion } from './avi/convert'
import { aviErrorText, aviSoundLoss } from './avi/messages'
import { formatPercent } from './avi/plan'
import { probeMedia, readAviStreams } from './container'
import { isAudioType, mimeFor, normalizeType } from './format'
import { stringsFor } from './i18n'
import { Player, type VideoSource } from './player'
import { installStyles } from './styles'

const locale = globalThis.orca?.locale
const strings = stringsFor(locale)
installStyles()
const player = new Player({ strings, locale })
document.body.append(player.root)
player.showMessage(strings.loading)

const api = globalThis.orca?.document
if (!api) {
  player.showMessage(strings.errorTitle, 'This page runs as an Orca custom editor.', 'error')
} else {
  let loaded = false
  let conversion: AviConversion | null = null

  /** Hands a playable Blob to the player; AVI has been converted to MP4 by then. */
  const play = (blob: Blob, fileType: string, size: number, facts: Partial<VideoSource>) => {
    player.load(
      {
        url: URL.createObjectURL(blob),
        // Orca never tells an editor the file's path or name: this only names saved snapshots.
        name: fileType ? `media.${fileType}` : 'media',
        size,
        type: fileType ? `.${fileType}` : '',
        ...facts
      },
      { keepPosition: loaded }
    )
    loaded = true
  }

  /** AVI: Chromium cannot play it, so the worker re-encodes it to MP4 first (src/avi). */
  const playAvi = (bytes: Uint8Array) => {
    conversion?.cancel()
    if (!loaded) {
      player.showMessage(strings.aviConverting, formatPercent(0))
    }
    const streams = readAviStreams(bytes)
    const current = convertAvi(bytes, (fraction) => {
      if (!loaded) {
        player.showMessage(strings.aviConverting, formatPercent(fraction))
      }
    })
    conversion = current
    current.promise.then(
      (result) => {
        if (conversion !== current) return
        conversion = null
        const { info } = result
        play(new Blob([result.buffer], { type: 'video/mp4' }), 'avi', bytes.byteLength, {
          audio: info.audioOnly,
          // The decoder's own rate: exact, so file info shows it and frame steps use it at once.
          fps: info.fps > 0 ? info.fps : undefined,
          hasVideoTrack: !info.audioOnly,
          // A sound stream that gave no sound: the video plays without it, and says why.
          ...(!info.audioOnly && !info.audioDelivered ? aviSoundLoss(streams) : {})
        })
      },
      (error: unknown) => {
        if (conversion !== current) return
        conversion = null
        loaded = false
        player.clear()
        const failure = error instanceof AviConversionError ? { code: error.code, codec: error.codec } : null
        player.showMessage(strings.errorTitle, aviErrorText(failure, strings, streams), 'error')
      }
    )
  }

  api.onDidChange((doc) => {
    if (doc.content.kind !== 'bytes') {
      player.showMessage(strings.errorTitle, strings.errorText, 'error')
      return
    }
    const bytes = new Uint8Array(doc.content.bytes)
    const fileType = normalizeType(doc.fileType)
    if (fileType === 'avi') {
      playAvi(bytes)
      return
    }
    // The header says which tracks there are before Chromium plays them: the frame duration for
    // frame steps, the video codec Chromium may not decode, sound in a codec it never plays.
    const probe = probeMedia(bytes, fileType)
    const blob = new Blob([bytes], { type: mimeFor(fileType) })
    play(blob, fileType, blob.size, {
      audio: isAudioType(fileType),
      frameDuration: probe.frameDuration,
      hasVideoTrack: probe.hasVideo,
      videoCodec: probe.videoCodec,
      droppedSound: probe.droppedSound
    })
  })
}
