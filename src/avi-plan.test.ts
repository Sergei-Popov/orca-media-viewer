import { assert, test } from 'orca/testing'
import { ArrayBufferTarget, Muxer } from '../vendor/mp4-muxer/mp4-muxer.mjs'
import { aviErrorText } from './avi/messages'
import {
  AUDIO_CANDIDATES,
  BT601,
  VIDEO_CANDIDATES,
  audioBitrate,
  frameColorSpace,
  frameSizeText,
  formatPercent,
  keyFrameInterval,
  muxerVideoTrack,
  openErrorCode,
  toMicroseconds,
  videoBitrate
} from './avi/plan'
import { readAviStreams } from './container'
import { DEFAULT_TYPES } from './format'
import { stringsFor } from './i18n'

test('opens AVI in the player by default', () => {
  assert.ok((DEFAULT_TYPES as readonly string[]).includes('avi'))
})

test('picks a bitrate between 1 and 16 Mbit/s', () => {
  assert.equal(videoBitrate(1280, 720, 25), 2_304_000)
  assert.equal(videoBitrate(320, 240, 15), 1_000_000)
  assert.equal(videoBitrate(3840, 2160, 60), 16_000_000)
  assert.equal(videoBitrate(640, 360, Number.NaN), 1_000_000)
})

test('puts a keyframe every two seconds', () => {
  assert.equal(keyFrameInterval(25), 50)
  assert.equal(keyFrameInterval(29.97), 60)
  assert.equal(keyFrameInterval(0), 50)
  assert.equal(keyFrameInterval(0.2), 1)
})

test('tries hardware H.264 before VP9, and Opus before AAC', () => {
  assert.equal(VIDEO_CANDIDATES[0].mux, 'avc')
  assert.equal(VIDEO_CANDIDATES[VIDEO_CANDIDATES.length - 1].mux, 'vp9')
  assert.equal(AUDIO_CANDIDATES[0].codec, 'opus')
  assert.equal(audioBitrate(2), 160_000)
  assert.equal(audioBitrate(1), 96_000)
})

test('maps decoder open errors', () => {
  assert.equal(openErrorCode(-2), 'not-avi')
  assert.equal(openErrorCode(-3), 'no-streams')
  assert.equal(openErrorCode(-4), 'video-codec')
  assert.equal(openErrorCode(-5), 'failed')
})

test('formats progress and timestamps', () => {
  assert.equal(formatPercent(0.4231), '42 %')
  assert.equal(formatPercent(2), '100 %')
  assert.equal(formatPercent(Number.NaN), '0 %')
  assert.equal(toMicroseconds(1.5), 1_500_000)
  assert.equal(toMicroseconds(-1), 0)
})

test('builds the MP4 muxer for a 24000/1001 (23.976 fps) AVI', () => {
  const fps = 24000 / 1001
  const muxer = () => ({ target: new ArrayBufferTarget(), fastStart: 'in-memory' as const, firstTimestampBehavior: 'cross-track-offset' as const })
  // 0.3.0 passed the rate to mp4-muxer, which takes only whole numbers.
  assert.throws(() => new Muxer({ ...muxer(), video: { codec: 'avc', width: 640, height: 360, frameRate: fps } }), /frame rate/i)
  const track = muxerVideoTrack('avc', 640, 360)
  assert.equal('frameRate' in track, false)
  new Muxer({ ...muxer(), video: track })
  new Muxer({ ...muxer(), video: muxerVideoTrack('vp9', 720, 480) })
  assert.equal(keyFrameInterval(fps), 48)
})

test('tags SD frames BT.601 and leaves HD to WebCodecs (BT.709)', () => {
  assert.deepEqual(frameColorSpace(360), { matrix: 'smpte170m', primaries: 'smpte170m', transfer: 'smpte170m', fullRange: false })
  assert.equal(frameColorSpace(576), BT601)
  assert.equal(frameColorSpace(718), BT601)
  assert.equal(frameColorSpace(720), undefined)
  assert.equal(frameColorSpace(1080), undefined)
  assert.equal(frameColorSpace(0), undefined)
})

test('says a supported codec that fails to open is a damaged file, and names a too-large frame', () => {
  const s = stringsFor('en')
  assert.equal(aviErrorText({ code: 'video-codec', codec: 'msmpeg4v3' }, s), 'The AVI file is damaged: its msmpeg4v3 video cannot be decoded.')
  assert.equal(aviErrorText({ code: 'video-codec', codec: 'mpeg4' }, s), 'The AVI file is damaged: its mpeg4 video cannot be decoded.')
  assert.equal(aviErrorText({ code: 'video-codec', codec: 'wmv2' }, s), 'This AVI uses the wmv2 video codec, which Media Player cannot decode.')
  assert.equal(aviErrorText({ code: 'too-large', codec: frameSizeText(16000, 16000) }, s), 'The video frame is 16000 × 16000 pixels, larger than Orca’s video encoder accepts.')
  assert.equal(aviErrorText({ code: 'encoder' }, s), 'Orca cannot re-encode video here: WebCodecs is not available.')
  assert.equal(aviErrorText(null, s), 'The AVI file could not be converted.')
  assert.equal(aviErrorText({ code: 'failed' }, stringsFor('ru')), 'Не удалось преобразовать файл AVI.')
})

test('names the sound of an AVI that has only sound the decoder cannot read', () => {
  const s = stringsFor('en')
  // RIFF 'AVI ' with one sound stream in WMA (format tag 0x0161), built byte by byte.
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
  const le = (value: number, length: number) => Array.from({ length }, (_, i) => Math.floor(value / 256 ** i) % 256)
  const chunk = (type: string, payload: number[]) => [...ascii(type), ...le(payload.length, 4), ...payload]
  const strl = chunk('LIST', [...ascii('strl'), ...chunk('strh', [...ascii('auds'), ...new Array<number>(52).fill(0)]), ...chunk('strf', [...le(0x0161, 2), ...new Array<number>(16).fill(0)])])
  const body = [...ascii('AVI '), ...chunk('LIST', [...ascii('hdrl'), ...chunk('avih', new Array<number>(56).fill(0)), ...strl])]
  const streams = readAviStreams(new Uint8Array([...ascii('RIFF'), ...le(body.length, 4), ...body]))
  assert.equal(aviErrorText({ code: 'no-streams' }, s, streams), 'The AVI file has only sound, in WMA, which Media Player cannot decode.')
  assert.equal(aviErrorText({ code: 'no-streams' }, s, []), 'The AVI file has no video or sound.')
})
