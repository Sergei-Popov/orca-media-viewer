// The custom editor: Orca opens a video from the file tree here and sends its bytes (files up to
// 64 MiB; Orca keeps larger ones out of custom editors, and the panel plays those). The viewer
// never edits, so Orca never saves the tab; an outside write reloads the clip at the same spot.

import { mimeFor } from './format'
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
    const fileType = (doc.fileType ?? '').replace(/^\./, '')
    const blob = new Blob([doc.content.bytes], { type: mimeFor(fileType) })
    player.load(
      {
        url: URL.createObjectURL(blob),
        // Orca never tells an editor the file's path or name; the type is all there is.
        name: fileType ? `video.${fileType}` : 'video',
        size: blob.size,
        type: fileType ? `.${fileType}` : ''
      },
      { keepPosition: loaded }
    )
    loaded = true
  })
}
