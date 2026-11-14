// The custom editor: Orca opens a media file in a main editor tab here — from the file tree, a file
// link in a chat, or `orca file open` — and sends its bytes. Orca keeps files over 64 MiB out of
// custom editors and shows its own notice instead. The player never edits, so Orca never saves the
// tab; an outside write reloads the media at the same position.

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
  api.onDidChange((doc) => {
    if (doc.content.kind !== 'bytes') {
      player.showMessage(strings.errorTitle, strings.errorText, 'error')
      return
    }
    const fileType = normalizeType(doc.fileType)
    const blob = new Blob([doc.content.bytes], { type: mimeFor(fileType) })
    player.load(
      {
        url: URL.createObjectURL(blob),
        // Orca never tells an editor the file's path or name; the type is all there is.
        name: fileType ? `media.${fileType}` : 'media',
        size: blob.size,
        type: fileType ? `.${fileType}` : '',
        audio: isAudioType(fileType)
      },
      { keepPosition: loaded }
    )
    loaded = true
  })
}
