import { assert, test } from 'orca/testing'
import {
  DEFAULT_TYPES,
  OPTION_TYPES,
  RATES,
  actionForKey,
  baseName,
  editorLimitBytes,
  extensionOf,
  formatBytes,
  formatPercentOf,
  formatRate,
  formatTime,
  infoRows,
  isAudioType,
  normalizeType,
  mimeFor,
  seekTarget,
  stageWithoutPicture,
  stepRate,
  timestampForFile
} from './format'
import { stringsFor } from './i18n'

/** Intl writes a no-break space before some units; tests compare with plain spaces. */
const plain = (text: string) => text.replace(/\s/g, ' ')

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

test('says a video codec does not play only when the header showed a video track', () => {
  assert.equal(stageWithoutPicture(false, true), 'no-picture')
  // No video track, an audio file, or a header that could not be read to its end: the audio cover.
  assert.equal(stageWithoutPicture(false, false), 'cover')
  assert.equal(stageWithoutPicture(false, undefined), 'cover')
  assert.equal(stageWithoutPicture(true, true), 'cover')
  assert.equal(stageWithoutPicture(true, undefined), 'cover')
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

test('has no full-screen shortcut: Orca denies full screen to plugin frames', () => {
  assert.equal(actionForKey({ key: 'f' }), null)
  assert.equal(actionForKey({ key: 'F' }), null)
  assert.equal(actionForKey({ key: 'а', code: 'KeyF' }), null)
  assert.equal('fullscreen' in stringsFor('en'), false)
})

test('letter shortcuts follow the physical key on a Russian layout', () => {
  const ru = (key: string, code: string, shiftKey = false) => actionForKey({ key, code, shiftKey })
  assert.deepEqual(ru('л', 'KeyK'), { kind: 'toggle-play' })
  assert.deepEqual(ru('о', 'KeyJ'), { kind: 'seek', delta: -10 })
  assert.deepEqual(ru('д', 'KeyL'), { kind: 'seek', delta: 10 })
  assert.deepEqual(ru('ь', 'KeyM'), { kind: 'mute' })
  assert.deepEqual(ru('к', 'KeyR'), { kind: 'loop' })
  assert.deepEqual(ru('ш', 'KeyI'), { kind: 'info' })
  assert.deepEqual(ru('ы', 'KeyS'), { kind: 'snapshot' })
  assert.deepEqual(ru('я', 'KeyZ'), { kind: 'fit' })
  assert.deepEqual(ru('б', 'Comma'), { kind: 'frame', direction: -1 })
  assert.deepEqual(ru('ю', 'Period'), { kind: 'frame', direction: 1 })
  assert.deepEqual(ru('Б', 'Comma', true), { kind: 'rate', direction: -1 })
  assert.deepEqual(ru('Ю', 'Period', true), { kind: 'rate', direction: 1 })
  assert.deepEqual(ru('Л', 'KeyK', true), { kind: 'toggle-play' })
  // AZERTY types & on the 1 key; with Shift it types 1, which matches directly.
  assert.deepEqual(actionForKey({ key: '&', code: 'Digit1' }), { kind: 'seek-fraction', fraction: 0.1 })
  assert.deepEqual(actionForKey({ key: '0', code: 'Digit0', shiftKey: true }), { kind: 'seek-fraction', fraction: 0 })
  assert.equal(actionForKey({ key: '!', code: 'Digit1', shiftKey: true }), null)
  // A Latin letter keeps its meaning (Dvorak types o on the S key), and Cmd/Ctrl stay Orca's.
  assert.equal(actionForKey({ key: 'o', code: 'KeyS' }), null)
  assert.equal(actionForKey({ key: 'ы', code: 'KeyS', metaKey: true }), null)
  assert.equal(actionForKey({ key: 'Dead', code: 'KeyM' }), null)
})

test('picks Russian strings for ru locales', () => {
  assert.equal(stringsFor('ru-RU').audio, 'Аудио')
  assert.equal(stringsFor('en-US').audio, 'Audio')
  assert.equal(stringsFor(undefined).audio, 'Audio')
  const en = stringsFor('en') as Record<string, unknown>
  const ru = stringsFor('ru') as Record<string, unknown>
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort())
  for (const key of Object.keys(en)) {
    if (typeof en[key] === 'string' && key !== 'seekBadge') assert.ok(en[key] !== ru[key], `ru.${key} is translated`)
  }
})

test('writes sizes, speeds and seek badges in the UI language', () => {
  const ru = stringsFor('ru')
  assert.equal(plain(formatBytes(1992294, ru.sizeUnits, 'ru')), '1,9 МБ')
  assert.equal(plain(formatBytes(288768, ru.sizeUnits, 'ru')), '282 КБ')
  assert.equal(plain(formatBytes(512, ru.sizeUnits, 'ru')), '512 Б')
  assert.equal(formatBytes(1992294, stringsFor('en').sizeUnits, 'en'), '1.9 MB')
  assert.equal(formatBytes(1000), '1000 B')
  assert.equal(formatRate(0.25, 'ru'), '0,25×')
  assert.equal(formatRate(1.5, 'en'), '1.5×')
  assert.equal(plain(formatPercentOf(0.5, 'ru')), '50 %')
  assert.equal(formatPercentOf(0.5, 'en'), '50%')
  assert.equal(plain(ru.seekBadge.replace('{n}', '+5')), '+5 с')
  assert.equal(stringsFor('en').seekBadge.replace('{n}', '−10'), '−10s')
  assert.equal(formatRate(2, 'not a locale!'), '2×')
})

test('knows Orca’s size limit per type: 50 MiB without a native viewer, 64 MiB with one', () => {
  for (const type of DEFAULT_TYPES) assert.equal(editorLimitBytes(type), 50 * 1024 * 1024, type)
  for (const type of OPTION_TYPES) assert.equal(editorLimitBytes(type), 64 * 1024 * 1024, type)
  assert.equal(editorLimitBytes('.MP4'), 64 * 1024 * 1024)
})

test('the decode error no longer says AVI does not play, and names the sound codecs', () => {
  const en = stringsFor('en').errorDecode
  const ru = stringsFor('ru').errorDecode
  assert.ok(!en.includes('and AVI do not play'))
  assert.ok(en.includes('MPEG-2 or DivX outside AVI'))
  assert.ok(en.includes('AC3, E-AC3, DTS and TrueHD sound does not play'))
  assert.ok(!ru.includes('DivX и AVI не'))
  assert.ok(ru.includes('AC3, E-AC3, DTS и TrueHD'))
})

test('lists file info without a made-up file name', () => {
  const s = stringsFor('en')
  const facts = { size: 11196490, picture: true, width: 1280, height: 720, duration: 60, fps: 23.976, type: '.avi' }
  assert.deepEqual(infoRows(facts, s, 'en'), [
    ['Size', '10.7 MB'],
    ['Resolution', '1280 × 720'],
    ['Duration', '1:00'],
    ['Frame rate', '23.976'],
    ['Type', '.avi']
  ])
  // Orca never sends the file name, so no row may claim one.
  assert.ok(infoRows(facts, s).every(([label, value]) => label !== 'File' && !value.startsWith('media.')))
  assert.deepEqual(infoRows({ size: 512, picture: true, width: 0, height: 0, duration: Number.NaN, fps: null, type: '' }, s), [
    ['Size', '512 B'],
    ['Resolution', 'unknown'],
    ['Duration', '--:--'],
    ['Frame rate', '— (measured during playback)'],
    ['Type', 'unknown']
  ])
  const ru = infoRows(facts, stringsFor('ru'), 'ru')
  assert.deepEqual(ru.map(([label, value]) => [label, plain(value)]), [
    ['Размер', '10,7 МБ'],
    ['Разрешение', '1280 × 720'],
    ['Длительность', '1:00'],
    ['Частота кадров', '23,976'],
    ['Тип', '.avi']
  ])
})

test('file info for sound has no resolution or frame rate rows', () => {
  const s = stringsFor('en')
  assert.deepEqual(infoRows({ size: 3_500_000, picture: false, width: 0, height: 0, duration: 214, fps: null, type: '.mka' }, s), [
    ['Size', '3.3 MB'],
    ['Duration', '3:34'],
    ['Type', '.mka']
  ])
})
