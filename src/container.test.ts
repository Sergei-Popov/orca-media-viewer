import { assert, test } from 'orca/testing'
import {
  MATROSKA_TRACK_LIMIT,
  MP4_BOX_LIMIT,
  MP4_BOX_TOTAL_LIMIT,
  probeMedia,
  readAviStreams,
  readMatroskaTracks,
  readMp4Tracks,
  soundFormatName,
  videoCodecName
} from './container'

// Test files are built here byte by byte, so the repository holds no media blobs.

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0))
}

function bigEndian(value: number, length: number): number[] {
  const out: number[] = []
  for (let i = length - 1; i >= 0; i -= 1) out.push(Math.floor(value / 256 ** i) % 256)
  return out
}

function littleEndian(value: number, length: number): number[] {
  return bigEndian(value, length).reverse()
}

// --- Matroska -----------------------------------------------------------------------------------

/** An EBML element: its ID bytes, an 8-byte size and the payload. */
function ebml(id: number[], payload: number[]): number[] {
  return [...id, 0x01, ...bigEndian(payload.length, 7), ...payload]
}

const uint = (id: number[], value: number) => ebml(id, bigEndian(value, 4))
const text = (id: number[], value: string) => ebml(id, ascii(value))

function matroska(tracks: number[][], { unknownSegmentSize = false } = {}): Uint8Array {
  const header = ebml([0x1a, 0x45, 0xdf, 0xa3], text([0x42, 0x82], 'matroska'))
  const info = ebml([0x15, 0x49, 0xa9, 0x66], uint([0x2a, 0xd7, 0xb1], 1_000_000))
  const trackList = ebml([0x16, 0x54, 0xae, 0x6b], tracks.flat())
  const cluster = ebml([0x1f, 0x43, 0xb6, 0x75], uint([0xe7], 0))
  const body = [...info, ...trackList, ...cluster]
  const segmentSize = unknownSegmentSize ? [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] : [0x01, ...bigEndian(body.length, 7)]
  return new Uint8Array([...header, 0x18, 0x53, 0x80, 0x67, ...segmentSize, ...body])
}

function videoTrack(codec: string, defaultDurationNs?: number): number[] {
  return ebml([0xae], [
    ...uint([0xd7], 1),
    ...uint([0x83], 1),
    ...text([0x86], codec),
    ...(defaultDurationNs ? uint([0x23, 0xe3, 0x83], defaultDurationNs) : []),
    ...ebml([0xe0], [...uint([0xb0], 640), ...uint([0xba], 360)])
  ])
}

function audioTrack(codec: string): number[] {
  return ebml([0xae], [...uint([0xd7], 2), ...uint([0x83], 2), ...text([0x86], codec)])
}

test('reads Matroska tracks: codec, frame duration, size', () => {
  const file = matroska([videoTrack('V_MPEG2', 41_708_333), audioTrack('A_AAC')])
  const tracks = readMatroskaTracks(file)
  assert.equal(tracks.length, 2)
  assert.deepEqual(tracks[0], { kind: 'video', codec: 'V_MPEG2', frameDuration: 0.041708333, width: 640, height: 360 })
  assert.deepEqual(tracks[1], { kind: 'audio', codec: 'A_AAC' })
  const probe = probeMedia(file, 'mkv')
  assert.equal(probe.hasVideo, true)
  assert.equal(probe.videoCodec, 'MPEG-2')
  assert.equal(probe.frameDuration, 0.041708333)
  assert.equal(probe.droppedSound, undefined)
})

test('reads a live Matroska file whose segment has no size', () => {
  const file = matroska([videoTrack('V_VP9', 33_333_333)], { unknownSegmentSize: true })
  assert.equal(probeMedia(file, 'webm').frameDuration, 0.033333333)
})

test('names sound Chromium does not play, only when no other sound track plays', () => {
  assert.equal(probeMedia(matroska([videoTrack('V_MPEG4/ISO/AVC'), audioTrack('A_AC3')]), 'mkv').droppedSound, 'AC3')
  assert.equal(probeMedia(matroska([videoTrack('V_MPEG4/ISO/AVC'), audioTrack('A_EAC3')]), 'mkv').droppedSound, 'E-AC3')
  assert.equal(probeMedia(matroska([videoTrack('V_MPEG4/ISO/AVC'), audioTrack('A_DTS')]), 'mkv').droppedSound, 'DTS')
  assert.equal(probeMedia(matroska([videoTrack('V_MPEG4/ISO/AVC'), audioTrack('A_TRUEHD')]), 'mkv').droppedSound, 'TrueHD')
  assert.equal(probeMedia(matroska([videoTrack('V_MPEG4/ISO/AVC'), audioTrack('A_AC3'), audioTrack('A_OPUS')]), 'mkv').droppedSound, undefined)
  assert.equal(probeMedia(matroska([videoTrack('V_MPEG4/ISO/AVC')]), 'mkv').droppedSound, undefined)
})

test('tells an audio-only Matroska file from a video one', () => {
  assert.equal(probeMedia(matroska([audioTrack('A_OPUS')]), 'mka').hasVideo, false)
  assert.equal(probeMedia(matroska([videoTrack('V_MPEG4/ISO/ASP')]), 'mkv').videoCodec, 'MPEG-4 Part 2')
})

test('returns nothing, without throwing, for damaged or foreign headers', () => {
  const file = matroska([videoTrack('V_MPEG2', 41_708_333)])
  for (let cut = 0; cut < file.length; cut += 7) {
    readMatroskaTracks(file.slice(0, cut))
  }
  assert.deepEqual(probeMedia(new Uint8Array(ascii('not a media file at all')), 'mkv'), { tracks: [] })
  assert.equal(probeMedia(new Uint8Array(0), 'mkv').hasVideo, undefined)
})

test('reads at most 128 Matroska TrackEntries', () => {
  assert.equal(MATROSKA_TRACK_LIMIT, 128)
  const many = matroska([videoTrack('V_VP9', 33_333_333), ...Array.from({ length: 199 }, () => audioTrack('A_OPUS'))])
  const tracks = readMatroskaTracks(many)
  assert.equal(tracks.length, 128)
  assert.equal(tracks[0].codec, 'V_VP9')
  // A crafted file: unknown-size Segment and Tracks, then 4 MiB of empty TrackEntries (AE 80).
  const head = [...ebml([0x1a, 0x45, 0xdf, 0xa3], text([0x42, 0x82], 'matroska'))]
  const unknown = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
  const lead = [...head, 0x18, 0x53, 0x80, 0x67, ...unknown, 0x16, 0x54, 0xae, 0x6b, ...unknown]
  const crafted = new Uint8Array(4 * 1024 * 1024)
  crafted.set(lead)
  for (let i = lead.length; i + 1 < crafted.length; i += 2) {
    crafted[i] = 0xae
    crafted[i + 1] = 0x80
  }
  assert.equal(readMatroskaTracks(crafted).length, 128)
})

// --- MP4 ----------------------------------------------------------------------------------------

function box(type: string, payload: number[]): number[] {
  return [...bigEndian(payload.length + 8, 4), ...ascii(type), ...payload]
}

function mp4Track(handler: string, entry: string, timescale: number, delta: number, tkhdFlags?: number): number[] {
  // tkhd version 0: version, 24 bits of flags (1 = enabled, 2 = in movie), 80 bytes of fields.
  const tkhd = tkhdFlags === undefined ? [] : box('tkhd', [0, 0, 0, tkhdFlags, ...new Array<number>(80).fill(0)])
  const mdhd = box('mdhd', [0, 0, 0, 0, ...bigEndian(0, 4), ...bigEndian(0, 4), ...bigEndian(timescale, 4), ...bigEndian(0, 4), 0, 0, 0, 0])
  const hdlr = box('hdlr', [0, 0, 0, 0, 0, 0, 0, 0, ...ascii(handler), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  const stsd = box('stsd', [0, 0, 0, 0, ...bigEndian(1, 4), ...box(entry, new Array<number>(8).fill(0))])
  const stts = box('stts', [0, 0, 0, 0, ...bigEndian(2, 4), ...bigEndian(1, 4), ...bigEndian(500, 4), ...bigEndian(240, 4), ...bigEndian(delta, 4)])
  return box('trak', [...tkhd, ...box('mdia', [...mdhd, ...hdlr, ...box('minf', box('stbl', [...stsd, ...stts]))])])
}

test('reads MP4 tracks wherever the moov box is', () => {
  const moov = box('moov', [...mp4Track('vide', 'mp4v', 24000, 1001), ...mp4Track('soun', 'ac-3', 48000, 1536)])
  const head = [...box('ftyp', ascii('isom')), ...box('mdat', new Array<number>(64).fill(7))]
  const file = new Uint8Array([...head, ...moov])
  const tracks = readMp4Tracks(file)
  assert.equal(tracks.length, 2)
  assert.equal(tracks[0].kind, 'video')
  assert.equal(tracks[0].frameDuration, 1001 / 24000)
  const probe = probeMedia(file, 'mov')
  assert.equal(probe.videoCodec, 'MPEG-4 Part 2')
  assert.equal(probe.droppedSound, 'AC3')
  assert.equal(probeMedia(new Uint8Array([...box('moov', mp4Track('soun', 'mp4a', 44100, 1024))]), 'm4a').hasVideo, false)
  assert.equal(probeMedia(new Uint8Array(box('moov', mp4Track('vide', 'apcn', 25, 1))), 'mov').videoCodec, 'ProRes')
})

test('judges only the enabled MP4 sound track: Chromium plays that one', () => {
  const mp4 = (...traks: number[][]) => new Uint8Array(box('moov', traks.flat()))
  const video = mp4Track('vide', 'avc1', 25, 1, 3)
  // AC3 enabled, AAC as a disabled alternate (ffmpeg's -disposition:a:0 default): no sound plays.
  const ac3First = probeMedia(mp4(video, mp4Track('soun', 'ac-3', 48000, 1536, 3), mp4Track('soun', 'mp4a', 48000, 1024, 2)), 'mp4')
  assert.deepEqual(ac3First.tracks.map((track) => track.enabled), [true, true, false])
  assert.equal(ac3First.droppedSound, 'AC3')
  assert.equal(probeMedia(mp4(video, mp4Track('soun', 'ec-3', 48000, 1536, 3), mp4Track('soun', 'mp4a', 48000, 1024, 2)), 'mov').droppedSound, 'E-AC3')
  // AAC enabled, AC3 disabled, in either order: the AAC plays.
  assert.equal(probeMedia(mp4(video, mp4Track('soun', 'ac-3', 48000, 1536, 2), mp4Track('soun', 'mp4a', 48000, 1024, 3)), 'mp4').droppedSound, undefined)
  assert.equal(probeMedia(mp4(video, mp4Track('soun', 'mp4a', 48000, 1024, 3), mp4Track('soun', 'ac-3', 48000, 1536, 2)), 'mp4').droppedSound, undefined)
  // Both enabled, or none enabled: every sound track counts, as before.
  assert.equal(probeMedia(mp4(video, mp4Track('soun', 'ac-3', 48000, 1536, 3), mp4Track('soun', 'mp4a', 48000, 1024, 3)), 'mp4').droppedSound, undefined)
  assert.equal(probeMedia(mp4(video, mp4Track('soun', 'ac-3', 48000, 1536, 2), mp4Track('soun', 'mp4a', 48000, 1024, 2)), 'mp4').droppedSound, undefined)
  assert.equal(probeMedia(mp4(video, mp4Track('soun', 'ac-3', 48000, 1536, 2)), 'mp4').droppedSound, 'AC3')
})

test('visits at most 10,000 MP4 boxes per level', () => {
  assert.equal(MP4_BOX_LIMIT, 10_000)
  const free = box('free', [])
  const moov = box('moov', mp4Track('vide', 'avc1', 25, 1))
  const after = (count: number, last: number[]) => {
    const file = new Uint8Array(count * free.length + last.length)
    for (let i = 0; i < count; i += 1) file.set(free, i * free.length)
    file.set(last, count * free.length)
    return file
  }
  // Top level: the moov box is the 10,000th box, then the 10,001st.
  assert.equal(readMp4Tracks(after(MP4_BOX_LIMIT - 1, moov)).length, 1)
  assert.equal(readMp4Tracks(after(MP4_BOX_LIMIT, moov)).length, 0)
  // Inside moov: the trak after 9,999 and after 10,000 other boxes.
  const inMoov = (count: number) => box('moov', [...Array.from(after(count, mp4Track('vide', 'avc1', 25, 1)))])
  assert.equal(readMp4Tracks(new Uint8Array(inMoov(MP4_BOX_LIMIT - 1))).length, 1)
  assert.equal(readMp4Tracks(new Uint8Array(inMoov(MP4_BOX_LIMIT))).length, 0)
  // Nesting cannot multiply the cap: 150 traks of 900 empty boxes each stop at 100,000 boxes in all.
  assert.equal(MP4_BOX_TOTAL_LIMIT, 100_000)
  const padded = box('trak', [...Array.from(after(900, [])), ...mp4Track('soun', 'mp4a', 48000, 1024).slice(8)])
  const nested = readMp4Tracks(new Uint8Array(box('moov', Array.from({ length: 150 }, () => padded).flat())))
  assert.ok(nested.length > 0 && nested.length < 150, `${nested.length} of 150 traks read`)
  // 64 MiB of empty boxes and no moov: nothing, after 10,000 boxes.
  const crafted = new Uint8Array(64 * 1024 * 1024)
  crafted.set(free)
  for (let filled = free.length; filled < crafted.length; filled *= 2) crafted.copyWithin(filled, 0, filled)
  assert.deepEqual(readMp4Tracks(crafted), [])
})

test('a header with no track, or read only up to a reader limit, leaves video and sound unknown', () => {
  // Nothing read: no notice may come from it.
  assert.deepEqual(probeMedia(new Uint8Array(box('ftyp', ascii('isom'))), 'mp4'), { tracks: [] })
  // AC3 in the first 128 Matroska tracks and AAC after them: the AAC may play, so no sound notice;
  // a video track after the limit is not known either.
  const cut = probeMedia(matroska([...Array.from({ length: 128 }, () => audioTrack('A_AC3')), audioTrack('A_AAC'), videoTrack('V_VP9')]), 'mkv')
  assert.equal(cut.tracks.length, 128)
  assert.equal(cut.hasVideo, undefined)
  assert.equal(cut.droppedSound, undefined)
  // The same tracks under the limit are read to the end: a video file whose AAC plays.
  const whole = probeMedia(matroska([audioTrack('A_AC3'), audioTrack('A_AAC'), videoTrack('V_VP9')]), 'mkv')
  assert.equal(whole.hasVideo, true)
  // An MP4 whose moov has an AC3 trak, then more boxes than one level may hold, then the AAC trak.
  const free = box('free', [])
  const padding = new Array<number>(MP4_BOX_LIMIT * free.length)
  for (let i = 0; i < padding.length; i += 1) padding[i] = free[i % free.length]
  const moov = (...traks: number[][]) => new Uint8Array(box('moov', traks.flat()))
  const mp4Cut = probeMedia(moov(mp4Track('soun', 'ac-3', 48000, 1536, 3), padding, mp4Track('soun', 'mp4a', 48000, 1024, 3)), 'mp4')
  assert.equal(mp4Cut.tracks.length, 1)
  assert.equal(mp4Cut.hasVideo, undefined)
  assert.equal(mp4Cut.droppedSound, undefined)
  // Without the padding, the AC3 alone is enabled: that sound does not play, and there is no video.
  const mp4Whole = probeMedia(moov(mp4Track('soun', 'ac-3', 48000, 1536, 3)), 'mp4')
  assert.equal(mp4Whole.hasVideo, false)
  assert.equal(mp4Whole.droppedSound, 'AC3')
  // A moov past the top-level limit (the audio-only MP4 of the review): nothing read, nothing claimed.
  const late = new Uint8Array([...padding, ...box('moov', mp4Track('soun', 'mp4a', 44100, 1024, 3))])
  assert.deepEqual(probeMedia(late, 'mp4'), { tracks: [] })
})

// --- AVI ----------------------------------------------------------------------------------------

function chunk(type: string, payload: number[]): number[] {
  const padded = payload.length % 2 ? [...payload, 0] : payload
  return [...ascii(type), ...littleEndian(payload.length, 4), ...padded]
}

function list(type: string, payload: number[]): number[] {
  return chunk('LIST', [...ascii(type), ...payload])
}

function avi(streams: number[][]): Uint8Array {
  const hdrl = list('hdrl', [...chunk('avih', new Array<number>(56).fill(0)), ...streams.flat()])
  const body = [...ascii('AVI '), ...hdrl, ...list('movi', [])]
  return new Uint8Array([...ascii('RIFF'), ...littleEndian(body.length, 4), ...body])
}

function videoStream(fourcc: string): number[] {
  const bitmap = [...littleEndian(40, 4), ...littleEndian(640, 4), ...littleEndian(360, 4), 1, 0, 24, 0, ...ascii(fourcc), ...new Array<number>(20).fill(0)]
  return list('strl', [...chunk('strh', [...ascii('vids'), ...ascii(fourcc), ...new Array<number>(48).fill(0)]), ...chunk('strf', bitmap)])
}

function soundStream(tag: number, extensibleTag?: number): number[] {
  const wave = [...littleEndian(tag, 2), 2, 0, ...littleEndian(48000, 4), ...littleEndian(192000, 4), 4, 0, 16, 0]
  const format = extensibleTag === undefined ? [...wave, 0, 0] : [...wave, 22, 0, 16, 0, 3, 0, 0, 0, ...littleEndian(extensibleTag, 2), ...new Array<number>(14).fill(0)]
  return list('strl', [...chunk('strh', [...ascii('auds'), 0, 0, 0, 0, ...new Array<number>(48).fill(0)]), ...chunk('strf', format)])
}

test('reads AVI streams: the video FourCC and the sound format tag', () => {
  const file = avi([videoStream('XVID'), soundStream(0x0161)])
  const streams = readAviStreams(file)
  assert.deepEqual(streams, [
    { kind: 'video', codec: 'fourcc:XVID' },
    { kind: 'audio', codec: 'wave:353' }
  ])
  assert.equal(videoCodecName(streams[0].codec), 'Xvid')
  assert.equal(soundFormatName(streams[1].codec), 'WMA')
  assert.deepEqual(readAviStreams(avi([videoStream('DIV3')])), [{ kind: 'video', codec: 'fourcc:DIV3' }])
  assert.equal(soundFormatName(readAviStreams(avi([soundStream(0xfffe, 0x2001)]))[0].codec), 'DTS')
  assert.equal(soundFormatName('wave:4660'), '0x1234')
  assert.deepEqual(readAviStreams(new Uint8Array(ascii('RIFF....WAVEfmt '))), [])
})
