// The custom editor: Orca opens a media file in a main editor tab here — from the file tree, a file
// link in a chat, or `orca file open` — and sends its bytes. Orca keeps files over 64 MiB out of
// custom editors and shows its own notice instead. The player never edits, so Orca never saves the
// tab; an outside write reloads the media at the same position.

import { AviConversionError, convertAvi, type AviConversion } from './avi/convert'
import { formatPercent } from './avi/plan'
import { isAudioType, mimeFor, normalizeType } from './format'
import { stringsFor } from './i18n'
import { Player } from './player'
import { installStyles } from './styles'

const strings = stringsFor(globalThis.orca?.locale)
installStyles()
const player = new Player({ strings })
document.body.append(player.root)
player.showMessage(strings.loading)

const api = globalThis.orca?.document
if (!api) {
  player.showMessage(strings.errorTitle, 'This page runs as an Orca custom editor.', 'error')
} else {
  let loaded = false
  let conversion: AviConversion | null = null

  /** Hands a playable Blob to the player; AVI has been converted to MP4 by then. */
  const play = (blob: Blob, fileType: string, size: number, audio: boolean) => {
    player.load(
      {
        url: URL.createObjectURL(blob),
        // Orca never tells an editor the file's path or name; the type is all there is.
        name: fileType ? `media.${fileType}` : 'media',
        size,
        type: fileType ? `.${fileType}` : '',
        audio
      },
      { keepPosition: loaded }
    )
    loaded = true
  }

  /** AVI: Chromium cannot play it, so the worker re-encodes it to MP4 first (src/avi). */
  const playAvi = (bytes: ArrayBuffer | Uint8Array) => {
    conversion?.cancel()
    if (!loaded) {
      player.showMessage(strings.aviConverting, formatPercent(0))
    }
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
        play(new Blob([result.buffer], { type: 'video/mp4' }), 'avi', bytes.byteLength, result.info.audioOnly)
      },
      (error: unknown) => {
        if (conversion !== current) return
        conversion = null
        loaded = false
        player.clear()
        player.showMessage(strings.errorTitle, aviErrorText(error), 'error')
      }
    )
  }

  api.onDidChange((doc) => {
    if (doc.content.kind !== 'bytes') {
      player.showMessage(strings.errorTitle, strings.errorText, 'error')
      return
    }
    const fileType = normalizeType(doc.fileType)
    if (fileType === 'avi') {
      playAvi(doc.content.bytes)
      return
    }
    const blob = new Blob([doc.content.bytes], { type: mimeFor(fileType) })
    play(blob, fileType, blob.size, isAudioType(fileType))
  })
}

function aviErrorText(error: unknown): string {
  if (!(error instanceof AviConversionError)) {
    return strings.aviFailed
  }
  switch (error.code) {
    case 'video-codec':
      return strings.aviCodec.replace('{codec}', error.codec || '?')
    case 'encoder':
      return strings.aviEncoder
    case 'not-avi':
      return strings.aviNotAvi
    case 'no-streams':
      return strings.aviNoStreams
    case 'memory':
      return strings.aviMemory
    default:
      return strings.aviFailed
  }
}
