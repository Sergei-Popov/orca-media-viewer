import { assert, test } from 'orca/testing'
import { probeMedia, readAviStreams, readMatroskaTracks, readMp4Tracks, soundFormatName, videoCodecName } from './container'

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

// --- MP4 ----------------------------------------------------------------------------------------

function box(type: string, payload: number[]): number[] {
  return [...bigEndian(payload.length + 8, 4), ...ascii(type), ...payload]
}

function mp4Track(handler: string, entry: string, timescale: number, delta: number): number[] {
  const mdhd = box('mdhd', [0, 0, 0, 0, ...bigEndian(0, 4), ...bigEndian(0, 4), ...bigEndian(timescale, 4), ...bigEndian(0, 4), 0, 0, 0, 0])
  const hdlr = box('hdlr', [0, 0, 0, 0, 0, 0, 0, 0, ...ascii(handler), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  const stsd = box('stsd', [0, 0, 0, 0, ...bigEndian(1, 4), ...box(entry, new Array<number>(8).fill(0))])
  const stts = box('stts', [0, 0, 0, 0, ...bigEndian(2, 4), ...bigEndian(1, 4), ...bigEndian(500, 4), ...bigEndian(240, 4), ...bigEndian(delta, 4)])
  return box('trak', box('mdia', [...mdhd, ...hdlr, ...box('minf', box('stbl', [...stsd, ...stts]))]))
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
