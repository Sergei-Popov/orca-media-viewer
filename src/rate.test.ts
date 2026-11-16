import { assert, test } from 'orca/testing'
import { FrameRateMeter, displayFps, frameStepTarget, snapFps, stepAnchor, type PendingStep } from './rate'

/** Presentation times of `count` frames at `fps`, rounded the way a container stores them. */
function frameTimes(fps: number, count: number, { roundToMs = false, start = 0 } = {}): number[] {
  const times: number[] = []
  for (let k = 0; k < count; k += 1) {
    const t = start + k / fps
    times.push(roundToMs ? Math.round(t * 1000) / 1000 : t)
  }
  return times
}

/** Feeds a meter frame by frame at 1×; returns the first solid rate and the media time it took. */
function measure(times: number[], { every = 1, decodedPerShown = 1, rate = 1 } = {}): { fps: number | null; after: number } {
  const meter = new FrameRateMeter()
  for (let i = 0; i < times.length; i += every) {
    const fps = meter.add(times[i], rate, i * decodedPerShown)
    if (fps !== null) return { fps, after: times[i] - times[0] }
  }
  return { fps: null, after: Number.NaN }
}

test('names declared frame rates by the common rate they are', () => {
  assert.equal(displayFps(24000 / 1001), 23.976)
  assert.equal(displayFps(30000 / 1001), 29.97)
  assert.equal(displayFps(60000 / 1001), 59.94)
  assert.equal(displayFps(25), 25)
  assert.equal(displayFps(12.5), 12.5)
  assert.equal(displayFps(1000000 / 33333), 30)
  assert.equal(displayFps(17.3), 17.3)
  assert.equal(snapFps(29.5), null)
})

test('measures Matroska frame rates despite millisecond timestamps', () => {
  // 30 and 60 fps MKV have 33/34 ms and 16/17 ms gaps: a single gap reads 29.97 or 62.5.
  for (const fps of [24, 25, 30, 50, 60]) {
    const result = measure(frameTimes(fps, 600, { roundToMs: true }))
    assert.equal(result.fps, fps, `${fps} fps`)
    assert.ok(result.after >= 1 && result.after < 2, `${fps} fps solid after ${result.after} s`)
  }
  assert.equal(measure(frameTimes(24000 / 1001, 600, { roundToMs: true })).fps, 23.976)
  assert.equal(measure(frameTimes(30000 / 1001, 600, { roundToMs: true })).fps, 29.97)
  assert.equal(measure(frameTimes(60000 / 1001, 600, { roundToMs: true })).fps, 59.94)
  assert.equal(measure(frameTimes(30, 600, { start: 0.021 })).fps, 30)
})

test('counts frames the screen skipped', () => {
  // A 60 fps clip whose compositor presents only some frames still reads 60.
  const times = frameTimes(60, 600, { roundToMs: true }).filter((_, i) => i % 5 !== 3)
  assert.equal(measure(times).fps, 60)
  // 120 fps on a 60 Hz screen: every shown frame skips one, the decoded-frame counter tells.
  assert.equal(measure(frameTimes(120, 600), { every: 2, decodedPerShown: 1 }).fps, 120)
})

test('measures only at 1x, and starts over after a seek', () => {
  assert.equal(measure(frameTimes(60, 600), { rate: 2 }).fps, null)
  const meter = new FrameRateMeter()
  const times = frameTimes(30, 20)
  for (const t of times) assert.equal(meter.add(t, 1), null)
  // A jump forward (a seek) drops the samples so far: no rate yet, half a second later.
  for (const t of frameTimes(30, 15, { start: 10 })) assert.equal(meter.add(t, 1), null)
  assert.equal(measure(frameTimes(30, 25)).fps, null)
})

/** Chromium shows, after a seek to `t`, the last frame that starts at or before `t`. */
function frameAt(times: number[], t: number): number {
  let index = 0
  for (let i = 0; i < times.length; i += 1) if (times[i] <= t + 1e-9) index = i
  return index
}

/**
 * Presses `.` (or `,`) `presses` times on a paused clip opened at 0, the way the player does:
 * the anchor comes from the presented frame, the target from the frame duration.
 */
function step(times: number[], frameDuration: number, presses: number, direction: 1 | -1, startIndex = 0, settle = true): number[] {
  let currentTime = times[startIndex]
  let shown: number | null = times[startIndex]
  let pending: PendingStep | null = null
  const seen = [startIndex]
  for (let i = 0; i < presses; i += 1) {
    const anchor = stepAnchor(currentTime, shown, pending, frameDuration)
    const target = frameStepTarget(anchor, frameDuration, direction, times[times.length - 1] + frameDuration)
    pending = { target, anchor: Math.max(0, anchor + direction * frameDuration) }
    currentTime = target
    const index = frameAt(times, target)
    // With `settle`, the new frame is presented before the next press; without, the key repeats.
    if (settle) shown = times[index]
    seen.push(index)
  }
  return seen
}

const ascending = (n: number, from = 0) => Array.from({ length: n + 1 }, (_, i) => from + i)

test('steps one frame per press at 24, 25, 30 and 60 fps, also with millisecond timestamps', () => {
  for (const fps of [24, 25, 30, 60, 24000 / 1001, 30000 / 1001]) {
    for (const roundToMs of [false, true]) {
      const times = frameTimes(fps, 40, { roundToMs })
      assert.deepEqual(step(times, 1 / fps, 12, 1), ascending(12), `${fps} fps, rounded ${roundToMs}`)
      assert.deepEqual(step(times, 1 / fps, 12, -1, 20), ascending(12, 8).reverse(), `${fps} fps back`)
      assert.deepEqual(step(times, 1 / fps, 12, 1, 0, false), ascending(12), `${fps} fps, key held`)
    }
  }
})

test('steps from the shown frame when the clip does not start on the frame grid', () => {
  const times = frameTimes(25, 40, { start: 0.021, roundToMs: true })
  assert.deepEqual(step(times, 1 / 25, 12, 1), ascending(12))
})

test('stays on the first and last frame at the ends', () => {
  const times = frameTimes(30, 10)
  assert.deepEqual(step(times, 1 / 30, 3, -1), [0, 0, 0, 0])
  assert.deepEqual(step(times, 1 / 30, 3, 1, 9), [9, 9, 9, 9])
})
