// The sidebar panel: plays video files of any size. A file picked or dropped here stays on disk;
// the <video> reads it through a `File` blob URL, so nothing is copied into memory or through Orca.

import { formatBytes, isVideoFile } from './format'
import { stringsFor } from './i18n'
import { icon } from './icons'
import { Player } from './player'
import { installStyles } from './styles'

type Entry = { id: number; file: File }

const strings = stringsFor(globalThis.orca?.locale)
installStyles()

const panel = document.createElement('div')
panel.className = 'vv-panel'

const head = document.createElement('div')
head.className = 'vv-panel-head'
const input = document.createElement('input')
input.type = 'file'
input.multiple = true
input.accept = 'video/*,.mp4,.m4v,.webm,.mov,.mkv'
input.className = 'vv-hidden'
const openButton = document.createElement('button')
openButton.type = 'button'
openButton.className = 'vv-btn primary'
openButton.innerHTML = `${icon('open')}<span>${strings.panelOpen}</span>`
const clearButton = document.createElement('button')
clearButton.type = 'button'
clearButton.className = 'vv-btn'
clearButton.title = strings.panelClear
clearButton.setAttribute('aria-label', strings.panelClear)
clearButton.innerHTML = icon('close')
const spacer = document.createElement('span')
spacer.className = 'vv-spacer'
head.append(openButton, spacer, clearButton, input)

const drop = document.createElement('div')
drop.className = 'vv-drop'
drop.innerHTML = icon('film')
const dropText = document.createElement('div')
dropText.textContent = strings.panelDrop
const dropHint = document.createElement('div')
dropHint.textContent = strings.panelHint
drop.append(dropText, dropHint)

const playerHost = document.createElement('div')
playerHost.className = 'vv-panel-player'
const list = document.createElement('ul')
list.className = 'vv-list'

panel.append(head, drop, playerHost, list)
document.body.append(panel)

let entries: Entry[] = []
let current: number | null = null
let nextId = 1

const player = new Player({ strings, onEnded: () => playNext() })
playerHost.append(player.root)

function render(): void {
  panel.classList.toggle('has-video', current !== null)
  clearButton.disabled = entries.length === 0
  list.replaceChildren(
    ...entries.map((entry) => {
      const item = document.createElement('li')
      item.className = `vv-item${entry.id === current ? ' current' : ''}`
      item.title = entry.file.name
      const name = document.createElement('span')
      name.className = 'vv-item-name'
      name.textContent = entry.file.name
      const size = document.createElement('span')
      size.className = 'vv-item-size'
      size.textContent = formatBytes(entry.file.size)
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'vv-btn'
      remove.title = strings.panelRemove
      remove.setAttribute('aria-label', strings.panelRemove)
      remove.innerHTML = icon('close')
      remove.addEventListener('click', (event) => {
        event.stopPropagation()
        removeEntry(entry.id)
      })
      item.append(name, size, remove)
      item.addEventListener('click', () => play(entry.id))
      return item
    })
  )
}

function play(id: number, autoplay = true): void {
  const entry = entries.find((candidate) => candidate.id === id)
  if (!entry) {
    return
  }
  current = id
  player.load(
    {
      url: URL.createObjectURL(entry.file),
      name: entry.file.name,
      size: entry.file.size,
      type: entry.file.type || entry.file.name.split('.').pop() || ''
    },
    { autoplay }
  )
  render()
}

function playNext(): void {
  const index = entries.findIndex((entry) => entry.id === current)
  const next = index >= 0 ? entries[index + 1] : undefined
  if (next) {
    play(next.id)
  }
}

function removeEntry(id: number): void {
  const index = entries.findIndex((entry) => entry.id === id)
  if (index < 0) {
    return
  }
  entries = entries.filter((entry) => entry.id !== id)
  if (current === id) {
    const replacement = entries[index] ?? entries[index - 1]
    if (replacement) {
      play(replacement.id, false)
      return
    }
    current = null
    player.clear()
  }
  render()
}

function addFiles(files: Iterable<File>): void {
  const added: Entry[] = []
  for (const file of files) {
    if (isVideoFile(file.name, file.type)) {
      added.push({ id: nextId++, file })
    }
  }
  if (added.length === 0) {
    return
  }
  entries = [...entries, ...added]
  play(added[0].id)
}

openButton.addEventListener('click', () => input.click())
input.addEventListener('change', () => {
  addFiles(Array.from(input.files ?? []))
  input.value = ''
})
clearButton.addEventListener('click', () => {
  entries = []
  current = null
  player.clear()
  render()
})

let dragDepth = 0
document.addEventListener('dragenter', (event) => {
  if (event.dataTransfer?.types.includes('Files')) {
    dragDepth += 1
    panel.classList.add('dragging')
  }
})
document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) {
    panel.classList.remove('dragging')
  }
})
document.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
})
document.addEventListener('drop', (event) => {
  event.preventDefault()
  dragDepth = 0
  panel.classList.remove('dragging')
  addFiles(Array.from(event.dataTransfer?.files ?? []))
})

render()
