import { assert, test } from 'orca/testing'
import { FAR_PROBE_SECONDS, NEAR_PROBE_SECONDS, findDuration } from './duration'

/**
 * A media element that only seeks. `onSeek` says what Chromium does on a seek to a time: which
 * duration it then reports (if any) and whether `seeked` fires. Events arrive after the seek, as
 * in a browser.
 */
class FakeMedia extends EventTarget {
  duration = Number.POSITIVE_INFINITY
  paused = true
  readonly seeks: number[] = []
  pauses = 0
  private time = 0

  constructor(private readonly onSeek: (time: number) => { duration?: number; seeked?: boolean; plays?: boolean } = () => ({ seeked: true })) {
    super()
  }

  get currentTime(): number {
    return this.time
  }

  set currentTime(time: number) {
    this.seeks.push(time)
    this.time = time
    const answer = this.onSeek(time)
    setTimeout(() => {
      if (answer.plays) this.paused = false
      if (answer.duration !== undefined) {
        this.duration = answer.duration
        this.dispatchEvent(new Event('durationchange'))
      }
      if (answer.seeked !== false) this.dispatchEvent(new Event('seeked'))
    }, 1)
  }

  pause(): void {
    this.pauses += 1
    this.paused = true
  }
}

test('leaves a file that declares its duration alone', async () => {
  const media = new FakeMedia()
  media.duration = 20
  assert.equal(await findDuration(media), 'declared')
  assert.deepEqual(media.seeks, [])
})

test('finds a piped file’s duration with an ordinary seek to 1 s, never the far seek', async () => {
  // Chromium learns the duration of a piped Matroska file on a seek into it.
  const media = new FakeMedia((time) => (time === NEAR_PROBE_SECONDS ? { duration: 19.992 } : {}))
  assert.equal(await findDuration(media), 'near')
  assert.deepEqual(media.seeks, [1, 0])
  assert.ok(!media.seeks.includes(FAR_PROBE_SECONDS))
  assert.equal(media.duration, 19.992)
  assert.equal(media.currentTime, 0)
  assert.equal(media.paused, true)
  assert.equal(media.pauses, 0)
})

test('falls back to the far seek when the first seek finds no duration, then goes back to 0', async () => {
  // A MediaRecorder WebM: the seek to 1 s ends with the duration still unknown.
  const media = new FakeMedia((time) => (time === FAR_PROBE_SECONDS ? { duration: 5.946 } : {}))
  assert.equal(await findDuration(media), 'far')
  assert.deepEqual(media.seeks, [1, FAR_PROBE_SECONDS, 0])
  assert.equal(media.duration, 5.946)
  assert.equal(media.currentTime, 0)
  assert.equal(media.paused, true)
})

test('takes the far seek when the first seek never answers, and gives up when neither finds it', async () => {
  const stuck = new FakeMedia((time) => (time === FAR_PROBE_SECONDS ? { duration: 6 } : { seeked: false }))
  assert.equal(await findDuration(stuck, 30), 'far')
  assert.deepEqual(stuck.seeks, [1, FAR_PROBE_SECONDS, 0])
  const never = new FakeMedia()
  assert.equal(await findDuration(never, 30), 'unknown')
  assert.deepEqual(never.seeks, [1, FAR_PROBE_SECONDS, 0])
  assert.equal(never.duration, Number.POSITIVE_INFINITY)
})

test('keeps the element paused: it never plays, and pauses again if a seek started playback', async () => {
  const media = new FakeMedia((time) => (time === NEAR_PROBE_SECONDS ? { duration: 20, plays: true } : {}))
  assert.equal('play' in media, false)
  assert.equal(await findDuration(media), 'near')
  assert.equal(media.paused, true)
  assert.equal(media.pauses, 1)
  assert.deepEqual(media.seeks, [1, 0])
})
