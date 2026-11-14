import { assert, test } from 'orca/testing'
import {
  AUDIO_CANDIDATES,
  VIDEO_CANDIDATES,
  audioBitrate,
  formatPercent,
  keyFrameInterval,
  openErrorCode,
  toMicroseconds,
  videoBitrate
} from './avi/plan'
import { DEFAULT_TYPES } from './format'

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
