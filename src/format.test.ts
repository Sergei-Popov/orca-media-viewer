import { assert, test } from 'orca/testing'
import {
  RATES,
  actionForKey,
  baseName,
  estimateFps,
  extensionOf,
  formatBytes,
  formatRate,
  formatTime,
  isAudioType,
  normalizeType,
  mimeFor,
  seekTarget,
  stepRate,
  timestampForFile
} from './format'
import { stringsFor } from './i18n'

test('formats times as m:ss and h:mm:ss', () => {
  assert.equal(formatTime(0), '0:00')
  assert.equal(formatTime(75.9), '1:15')
  assert.equal(formatTime(3725), '1:02:05')
  assert.equal(formatTime(Number.NaN), '--:--')
  assert.equal(formatTime(Number.POSITIVE_INFINITY), '--:--')
})

test('makes file-safe timestamps', () => {
  assert.equal(timestampForFile(75.25), '00-01-15.250')
  assert.equal(timestampForFile(3661.001), '01-01-01.001')
  assert.equal(timestampForFile(Number.NaN), '00-00-00.000')
})

test('formats sizes in binary units', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(91134175), '86.9 MB')
  assert.equal(formatBytes(-1), '—')
})

test('maps file types to MIME hints', () => {
  assert.equal(mimeFor('mp4'), 'video/mp4')
  assert.equal(mimeFor('.MOV'), 'video/mp4')
  assert.equal(mimeFor('webm'), 'video/webm')
  assert.equal(mimeFor('mkv'), 'video/x-matroska')
  assert.equal(mimeFor(undefined), '')
})

test('recognises audio types and normalises suffixes', () => {
  assert.equal(extensionOf('clip.MP4'), 'mp4')
  assert.equal(extensionOf('noext'), '')
  assert.equal(normalizeType('.FLAC'), 'flac')
  assert.equal(isAudioType('mp3'), true)
  assert.equal(isAudioType('.weba'), true)
  assert.equal(isAudioType('mkv'), false)
  assert.equal(mimeFor('mka'), 'audio/x-matroska')
  assert.equal(mimeFor('opus'), 'audio/ogg')
})

test('steps through playback rates and stops at the ends', () => {
  assert.equal(stepRate(1, 1), 1.25)
  assert.equal(stepRate(1, -1), 0.75)
  assert.equal(stepRate(RATES[RATES.length - 1], 1), RATES[RATES.length - 1])
  assert.equal(stepRate(RATES[0], -1), RATES[0])
  assert.equal(stepRate(1.1, 1), 1.25)
  assert.equal(formatRate(0.25), '0.25×')
})

test('keeps seeks inside the clip', () => {
  assert.equal(seekTarget(2, -5, 30), 0)
  assert.equal(seekTarget(28, 5, 30), 30)
  assert.equal(seekTarget(10, 5, Number.NaN), 15)
})

test('estimates common frame rates', () => {
  assert.equal(estimateFps(1, 30), 30)
  assert.equal(estimateFps(0.5005, 15), 29.97)
  assert.equal(estimateFps(1, 25), 25)
  assert.equal(estimateFps(0, 3), null)
})

test('names snapshots after the file', () => {
  assert.equal(baseName('/a/b/clip.final.mp4'), 'clip.final')
  assert.equal(baseName('video'), 'video')
})

test('maps keys to player actions and leaves modified keys to Orca', () => {
  assert.deepEqual(actionForKey({ key: ' ' }), { kind: 'toggle-play' })
  assert.deepEqual(actionForKey({ key: 'ArrowRight' }), { kind: 'seek', delta: 5 })
  assert.deepEqual(actionForKey({ key: 'ArrowLeft', shiftKey: true }), { kind: 'seek', delta: -1 })
  assert.deepEqual(actionForKey({ key: '5' }), { kind: 'seek-fraction', fraction: 0.5 })
  assert.deepEqual(actionForKey({ key: '>' }), { kind: 'rate', direction: 1 })
  assert.deepEqual(actionForKey({ key: '.' }), { kind: 'frame', direction: 1 })
  assert.equal(actionForKey({ key: 's', metaKey: true }), null)
  assert.equal(actionForKey({ key: 'w', ctrlKey: true }), null)
  assert.equal(actionForKey({ key: 'q' }), null)
})

test('picks Russian strings for ru locales', () => {
  assert.equal(stringsFor('ru-RU').audio, 'Аудио')
  assert.equal(stringsFor('en-US').audio, 'Audio')
  assert.equal(stringsFor(undefined).audio, 'Audio')
})
