import { assert, test } from 'orca/testing'
import type { Track } from './container'
import { FAR_PROBE_SECONDS, findDuration, probesDuration } from './duration'

type SeekAnswer = { duration?: number; seeked?: boolean; plays?: boolean; error?: boolean; decodes?: boolean }

/**
 * A media element that only seeks. `onSeek` says what Chromium does on a seek to a time: which
 * duration it then reports (if any), whether `seeked` fires, whether the seek fails with a media
 * error and whether it decodes a video frame. Events arrive after the seek, as in a browser.
 */
class FakeMedia extends EventTarget {
  duration = Number.POSITIVE_INFINITY
  paused = true
  videoWidth = 0
  frames = 0
  readonly seeks: number[] = []
  pauses = 0
  private time = 0

  constructor(private readonly onSeek: (time: number) => SeekAnswer = () => ({ seeked: true })) {
    super()
  }

  get currentTime(): number {
    return this.time
  }

  set currentTime(time: number) {
    this.seeks.push(time)
    this.time = Math.min(time, this.duration)
    const answer = this.onSeek(time)
    setTimeout(() => {
      if (answer.error) {
        this.dispatchEvent(new Event('error'))
        return
      }
      if (answer.plays) this.paused = false
      if (answer.duration !== undefined) {
        this.duration = answer.duration
        this.time = Math.min(time, answer.duration)
        this.dispatchEvent(new Event('durationchange'))
      }
      if (this.videoWidth > 0 && answer.decodes !== false) this.frames += 1
      if (answer.seeked !== false) this.dispatchEvent(new Event('seeked'))
    }, 1)
  }

  pause(): void {
    this.pauses += 1
    this.paused = true
  }
}

/** A video element: 320 px wide, counting decoded frames. */
function video(onSeek?: (time: number) => SeekAnswer): FakeMedia {
  const media = new FakeMedia(onSeek)
  media.videoWidth = 320
  return media
}

const quick = (media: FakeMedia, signal?: AbortSignal) =>
  findDuration(media, { decodedFrames: () => media.frames, signal, seekTimeoutMs: 40, pictureTimeoutMs: 40 })

test('leaves a file that declares its duration alone', async () => {
  const media = video()
  media.duration = 20
  assert.equal(await quick(media), 'declared')
  assert.deepEqual(media.seeks, [])
})

test('never probes H.264 or HEVC in Matroska or WebM; every other file without a duration is probed', () => {
  const h264: Track = { kind: 'video', codec: 'V_MPEG4/ISO/AVC' }
  const hevc: Track = { kind: 'video', codec: 'V_MPEGH/ISO/HEVC' }
  const aac: Track = { kind: 'audio', codec: 'A_AAC' }
  // A pipe, a crashed recording, MediaRecorder's video/x-matroska;codecs=avc1 and video/webm;codecs=h264.
  for (const type of ['mkv', 'webm']) {
    assert.equal(probesDuration(type, [h264, aac]), false, `${type} H.264`)
    assert.equal(probesDuration(type, [aac, hevc]), false, `${type} HEVC`)
  }
  for (const codec of ['V_VP8', 'V_VP9', 'V_AV1']) {
    assert.equal(probesDuration('webm', [{ kind: 'video', codec }, { kind: 'audio', codec: 'A_OPUS' }]), true, codec)
    assert.equal(probesDuration('mkv', [{ kind: 'video', codec }]), true, codec)
  }
  assert.equal(probesDuration('weba', [{ kind: 'audio', codec: 'A_OPUS' }]), true)
  assert.equal(probesDuration('mka', [aac]), true)
  // MP4 is not Matroska; an unread header leaves the safety net to catch a failure.
  assert.equal(probesDuration('mp4', [{ kind: 'video', codec: 'avc1' }]), true)
  assert.equal(probesDuration('mkv', []), true)
})

test('finds a missing duration with one seek past the end, then goes back to 0', async () => {
  // A MediaRecorder WebM or a live capture: Chromium reads the file to its end on the far seek.
  const media = video((time) => (time === FAR_PROBE_SECONDS ? { duration: 5.946 } : {}))
  assert.equal(await quick(media), 'found')
  assert.deepEqual(media.seeks, [FAR_PROBE_SECONDS, 0])
  assert.equal(media.duration, 5.946)
  assert.equal(media.currentTime, 0)
  assert.equal(media.paused, true)
  // Sound only: no picture to wait for.
  const sound = new FakeMedia((time) => (time === FAR_PROBE_SECONDS ? { duration: 6.001 } : {}))
  assert.equal(await quick(sound), 'found')
  assert.deepEqual(sound.seeks, [FAR_PROBE_SECONDS, 0])
})

test('goes back to 0 when the far seek finds no duration or never answers', async () => {
  const none = video()
  assert.equal(await quick(none), 'unknown')
  assert.deepEqual(none.seeks, [FAR_PROBE_SECONDS, 0])
  assert.equal(none.duration, Number.POSITIVE_INFINITY)
  const silent = video((time) => (time === FAR_PROBE_SECONDS ? { seeked: false } : {}))
  assert.equal(await quick(silent), 'unknown')
  assert.deepEqual(silent.seeks, [FAR_PROBE_SECONDS, 0])
})

test('asks to reopen the file without a probe after a media error or when no frame decodes', async () => {
  // A decode error on the far seek: the element is not touched again.
  const failing = video((time) => (time === FAR_PROBE_SECONDS ? { error: true } : {}))
  assert.equal(await quick(failing), 'fallback')
  assert.deepEqual(failing.seeks, [FAR_PROBE_SECONDS])
  const failingBack = video((time) => (time === 0 ? { error: true } : { duration: 20 }))
  assert.equal(await quick(failingBack), 'fallback')
  // The duration is found, but after the seek back to 0 the decoder gives no frame.
  const dark = video((time) => (time === FAR_PROBE_SECONDS ? { duration: 20 } : { decodes: false }))
  assert.equal(await quick(dark), 'fallback')
  assert.deepEqual(dark.seeks, [FAR_PROBE_SECONDS, 0])
  // Sound only, or a video stream Chromium does not decode (videoWidth 0): no frame is expected.
  const sound = new FakeMedia((time) => (time === FAR_PROBE_SECONDS ? { duration: 20 } : {}))
  assert.equal(await quick(sound), 'found')
})

test('stops at once when another source replaces this one', async () => {
  const controller = new AbortController()
  const media = video((time) => (time === FAR_PROBE_SECONDS ? { seeked: false } : {}))
  const result = quick(media, controller.signal)
  controller.abort()
  assert.equal(await result, 'aborted')
  // The new source's playhead is left alone: no seek back to 0.
  assert.deepEqual(media.seeks, [FAR_PROBE_SECONDS])
})

test('keeps the element paused: it never plays, and pauses again if a seek started playback', async () => {
  const media = video((time) => (time === FAR_PROBE_SECONDS ? { duration: 20, plays: true } : {}))
  assert.equal('play' in media, false)
  assert.equal(await quick(media), 'found')
  assert.equal(media.paused, true)
  assert.equal(media.pauses, 1)
  assert.deepEqual(media.seeks, [FAR_PROBE_SECONDS, 0])
})
