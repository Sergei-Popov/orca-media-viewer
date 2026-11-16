// Small readers for the headers of the containers Media Player opens: Matroska/WebM (EBML),
// MP4/QuickTime (ISO BMFF boxes) and AVI (RIFF). Pure: no DOM, no Orca, so `orca plugin test`
// runs them in Node. They read only what the player needs (which tracks there are, their codecs
// and the video's frame duration), look at a bounded part of the file and return what they found;
// a damaged or unknown header gives an empty result, never an exception.

/** One track of a media file, as the container declares it. */
export type Track = {
  kind: 'video' | 'audio' | 'other'
  /** The container's codec id: a Matroska CodecID, an MP4 sample entry, an AVI FourCC or format tag. */
  codec: string
  /** Seconds per frame the container declares for a video track, when it does. */
  frameDuration?: number
  width?: number
  height?: number
  /** MP4/QuickTime: the track header's enabled flag. Chromium plays only an enabled sound track. */
  enabled?: boolean
}

/** What the player learns from a file's header before Chromium plays it. */
export type MediaProbe = {
  /** The container's tracks; empty when the header could not be read. */
  tracks: Track[]
  /**
   * False when the header was read and has no video track; undefined when it is not known: no
   * track was found, or the read stopped at one of the reader's limits (a crafted or damaged file).
   */
  hasVideo?: boolean
  /** The first video track's codec, named for people (`MPEG-2`, `HEVC (H.265)`), when known. */
  videoCodec?: string
  /** Seconds per frame of the first video track, when the container declares it. */
  frameDuration?: number
  /**
   * A sound codec Chromium does not play, when every sound track of the file is in one; in MP4
   * and QuickTime, every enabled sound track (when the file enables none, every sound track).
   */
  droppedSound?: string
}

/** Matroska/WebM headers are read from the first 4 MiB at most: Tracks always come before Clusters. */
export const MATROSKA_HEADER_LIMIT = 4 * 1024 * 1024
/** The AVI header list (hdrl) sits at the start; 1 MiB is far more than any real one needs. */
export const AVI_HEADER_LIMIT = 1024 * 1024
/** Matroska TrackEntries read at most: real files have a handful, a crafted one millions. */
export const MATROSKA_TRACK_LIMIT = 128
/** MP4 boxes visited at most per level, so a crafted file of tiny boxes is not walked to its end. */
export const MP4_BOX_LIMIT = 10_000
/** MP4 boxes visited at most in one read, so nesting cannot multiply MP4_BOX_LIMIT; real files need hundreds. */
export const MP4_BOX_TOTAL_LIMIT = 100_000

/** The tracks a reader found, and whether it stopped at one of its limits before the header's end. */
type HeaderRead = { tracks: Track[]; truncated: boolean }

/** The header of a file of this type (`mkv`, `mp4`, `avi` …); an empty probe for other types. */
export function probeMedia(bytes: Uint8Array, fileType: string): MediaProbe {
  let read: HeaderRead
  switch (fileType) {
    case 'mkv':
    case 'mka':
    case 'webm':
    case 'weba':
      read = readMatroska(bytes)
      break
    case 'mp4':
    case 'm4v':
    case 'mov':
    case 'm4a':
      read = readMp4(bytes)
      break
    case 'avi':
      read = { tracks: readAviStreams(bytes), truncated: false }
      break
    default:
      read = { tracks: [], truncated: false }
  }
  return summarize(read.tracks, read.truncated)
}

/**
 * The probe's summary of a track list. With no track, or a read cut short at a limit, the file's
 * video and sound are unknown: no notice is drawn from them.
 */
export function summarize(tracks: Track[], truncated = false): MediaProbe {
  const probe: MediaProbe = { tracks }
  if (tracks.length === 0 || truncated) {
    return probe
  }
  const video = tracks.find((track) => track.kind === 'video')
  probe.hasVideo = video !== undefined
  if (video) {
    probe.videoCodec = videoCodecName(video.codec)
    if (video.frameDuration) {
      probe.frameDuration = video.frameDuration
    }
  }
  const sound = tracks.filter((track) => track.kind === 'audio')
  // Chromium plays the enabled sound track of an MP4, not another one it could decode.
  const enabled = sound.filter((track) => track.enabled !== false)
  const audio = enabled.length > 0 ? enabled : sound
  const unplayable = audio.map((track) => unplayableSoundName(track.codec))
  if (audio.length > 0 && unplayable.every((name) => name !== null)) {
    probe.droppedSound = unplayable[0] ?? undefined
  }
  return probe
}

// ---------------------------------------------------------------------------------------------
// Matroska / WebM

const EBML = 0x1a45dfa3
const SEGMENT = 0x18538067
const TRACKS = 0x1654ae6b
const CLUSTER = 0x1f43b675
const TRACK_ENTRY = 0xae
const TRACK_TYPE = 0x83
const CODEC_ID = 0x86
const CODEC_PRIVATE = 0x63a2
const DEFAULT_DURATION = 0x23e383
const VIDEO = 0xe0
const PIXEL_WIDTH = 0xb0
const PIXEL_HEIGHT = 0xba

type Element = { id: number; start: number; end: number; next: number; unknownSize: boolean }

/** The element at `pos`, with its data range clipped to `limit`; null past the end or when broken. */
function readElement(bytes: Uint8Array, pos: number, limit: number): Element | null {
  const id = readVint(bytes, pos, limit, true)
  if (!id || id.length > 4) {
    return null
  }
  const size = readVint(bytes, pos + id.length, limit, false)
  if (!size) {
    return null
  }
  const start = pos + id.length + size.length
  const end = size.unknown ? limit : Math.min(limit, start + size.value)
  return { id: id.value, start, end, next: size.unknown ? limit : start + size.value, unknownSize: size.unknown }
}

/** An EBML variable-length integer. IDs keep their length marker; sizes drop it (all ones = unknown). */
function readVint(
  bytes: Uint8Array,
  pos: number,
  limit: number,
  keepMarker: boolean
): { value: number; length: number; unknown: boolean } | null {
  if (pos >= limit) {
    return null
  }
  const first = bytes[pos]
  let length = 1
  let mask = 0x80
  while (length <= 8 && !(first & mask)) {
    length += 1
    mask >>= 1
  }
  if (length > 8 || pos + length > limit) {
    return null
  }
  let value = keepMarker ? first : first & (mask - 1)
  let allOnes = (first & (mask - 1)) === mask - 1
  for (let i = 1; i < length; i += 1) {
    value = value * 256 + bytes[pos + i]
    allOnes &&= bytes[pos + i] === 0xff
  }
  return { value, length, unknown: !keepMarker && allOnes }
}

function readUint(bytes: Uint8Array, element: Element): number {
  let value = 0
  for (let i = element.start; i < element.end && i < element.start + 8; i += 1) {
    value = value * 256 + bytes[i]
  }
  return value
}

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  let text = ''
  for (let i = start; i < end && i < start + 64; i += 1) {
    const c = bytes[i]
    if (c === 0) {
      break
    }
    text += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '?'
  }
  return text
}

/** Children of a master element, in order; stops at the first broken one. */
function* children(bytes: Uint8Array, start: number, end: number): Generator<Element> {
  let pos = start
  while (pos < end) {
    const child = readElement(bytes, pos, end)
    if (!child || child.next <= pos) {
      return
    }
    yield child
    if (child.unknownSize) {
      return
    }
    pos = child.next
  }
}

/** The tracks of a Matroska or WebM file, read from its first few MiB. */
export function readMatroskaTracks(bytes: Uint8Array): Track[] {
  return readMatroska(bytes).tracks
}

function readMatroska(bytes: Uint8Array): HeaderRead {
  const none: HeaderRead = { tracks: [], truncated: false }
  const limit = Math.min(bytes.length, MATROSKA_HEADER_LIMIT)
  const header = readElement(bytes, 0, limit)
  if (!header || header.id !== EBML) {
    return none
  }
  const segment = readElement(bytes, header.next, limit)
  if (!segment || segment.id !== SEGMENT) {
    return none
  }
  for (const child of children(bytes, segment.start, segment.end)) {
    if (child.id === CLUSTER) {
      break
    }
    if (child.id === TRACKS) {
      const tracks: Track[] = []
      // Tracks that run past MATROSKA_HEADER_LIMIT (or the end of the bytes) are read only in part.
      let truncated = !child.unknownSize && child.next > limit
      for (const entry of children(bytes, child.start, child.end)) {
        if (entry.id === TRACK_ENTRY) {
          tracks.push(readTrackEntry(bytes, entry))
          if (tracks.length >= MATROSKA_TRACK_LIMIT) {
            truncated = true
            break
          }
        }
      }
      return { tracks, truncated }
    }
  }
  return none
}

function readTrackEntry(bytes: Uint8Array, entry: Element): Track {
  let type = 0
  let codec = ''
  let defaultDuration = 0
  let privateData: Element | null = null
  let width: number | undefined
  let height: number | undefined
  for (const field of children(bytes, entry.start, entry.end)) {
    switch (field.id) {
      case TRACK_TYPE:
        type = readUint(bytes, field)
        break
      case CODEC_ID:
        codec = readAscii(bytes, field.start, field.end)
        break
      case DEFAULT_DURATION:
        defaultDuration = readUint(bytes, field)
        break
      case CODEC_PRIVATE:
        privateData = field
        break
      case VIDEO:
        for (const video of children(bytes, field.start, field.end)) {
          if (video.id === PIXEL_WIDTH) width = readUint(bytes, video)
          if (video.id === PIXEL_HEIGHT) height = readUint(bytes, video)
        }
        break
    }
  }
  // Video for Windows in Matroska: the real codec is the FourCC in the BITMAPINFOHEADER.
  if (codec === 'V_MS/VFW/FOURCC' && privateData && privateData.end - privateData.start >= 20) {
    codec = `fourcc:${readAscii(bytes, privateData.start + 16, privateData.start + 20)}`
  }
  const track: Track = { kind: type === 1 ? 'video' : type === 2 ? 'audio' : 'other', codec }
  const seconds = defaultDuration / 1e9
  if (track.kind === 'video' && plausibleFrameDuration(seconds)) {
    track.frameDuration = seconds
  }
  if (width) track.width = width
  if (height) track.height = height
  return track
}

// ---------------------------------------------------------------------------------------------
// MP4 / QuickTime

type Box = { type: string; start: number; end: number }
/** How many more boxes one read of a file may visit (MP4_BOX_TOTAL_LIMIT), and whether a limit stopped it. */
type Budget = { left: number; stopped: boolean }

function u32(bytes: Uint8Array, pos: number): number {
  return ((bytes[pos] << 24) >>> 0) + (bytes[pos + 1] << 16) + (bytes[pos + 2] << 8) + bytes[pos + 3]
}

function fourcc(bytes: Uint8Array, pos: number): string {
  return readAscii(bytes, pos, pos + 4).padEnd(4, ' ')
}

/**
 * Boxes between `start` and `end`: MP4_BOX_LIMIT at most, and no more than the read's budget;
 * stops at the first one that does not fit.
 */
function* boxes(bytes: Uint8Array, start: number, end: number, budget: Budget): Generator<Box> {
  let pos = start
  let visited = 0
  for (; pos + 8 <= end && visited < MP4_BOX_LIMIT && budget.left > 0; visited += 1) {
    budget.left -= 1
    let size = u32(bytes, pos)
    let header = 8
    if (size === 1) {
      if (pos + 16 > end) return
      size = u32(bytes, pos + 8) * 2 ** 32 + u32(bytes, pos + 12)
      header = 16
    } else if (size === 0) {
      size = end - pos
    }
    if (size < header || pos + size > end) {
      return
    }
    yield { type: fourcc(bytes, pos + 4), start: pos + header, end: pos + size }
    pos += size
  }
  // Out of the loop with boxes left: MP4_BOX_LIMIT or the read's budget stopped it.
  if (pos + 8 <= end) {
    budget.stopped = true
  }
}

function child(bytes: Uint8Array, parent: Box, type: string, budget: Budget): Box | null {
  for (const box of boxes(bytes, parent.start, parent.end, budget)) {
    if (box.type === type) return box
  }
  return null
}

/** The tracks of an MP4 or QuickTime file, wherever its `moov` box is. */
export function readMp4Tracks(bytes: Uint8Array): Track[] {
  return readMp4(bytes).tracks
}

function readMp4(bytes: Uint8Array): HeaderRead {
  const budget: Budget = { left: MP4_BOX_TOTAL_LIMIT, stopped: false }
  let moov: Box | null = null
  for (const box of boxes(bytes, 0, bytes.length, budget)) {
    if (box.type === 'moov') {
      moov = box
      break
    }
  }
  if (!moov) {
    return { tracks: [], truncated: budget.stopped }
  }
  const tracks: Track[] = []
  for (const trak of boxes(bytes, moov.start, moov.end, budget)) {
    if (trak.type !== 'trak') continue
    const mdia = child(bytes, trak, 'mdia', budget)
    const hdlr = mdia && child(bytes, mdia, 'hdlr', budget)
    const minf = mdia && child(bytes, mdia, 'minf', budget)
    const stbl = minf && child(bytes, minf, 'stbl', budget)
    if (!mdia || !hdlr || hdlr.end - hdlr.start < 12) continue
    const handler = fourcc(bytes, hdlr.start + 8)
    const kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : 'other'
    const stsd = stbl && child(bytes, stbl, 'stsd', budget)
    const codec = stsd && stsd.end - stsd.start >= 16 ? fourcc(bytes, stsd.start + 12).trim() : ''
    const track: Track = { kind, codec }
    if (kind === 'video') {
      const duration = sampleDuration(bytes, mdia, stbl, budget)
      if (duration) track.frameDuration = duration
    }
    // tkhd: version (1 byte), then 24 bits of flags; bit 0 says the track is enabled.
    const tkhd = child(bytes, trak, 'tkhd', budget)
    if (tkhd && tkhd.end - tkhd.start >= 4) {
      track.enabled = (bytes[tkhd.start + 3] & 1) === 1
    }
    tracks.push(track)
  }
  return { tracks, truncated: budget.stopped }
}

/** Seconds per sample from the sample table: the delta that covers the most samples. */
function sampleDuration(bytes: Uint8Array, mdia: Box, stbl: Box | null, budget: Budget): number | null {
  const mdhd = child(bytes, mdia, 'mdhd', budget)
  const stts = stbl && child(bytes, stbl, 'stts', budget)
  if (!mdhd || !stts || stts.end - stts.start < 8) return null
  const version = bytes[mdhd.start]
  const scaleAt = mdhd.start + (version === 1 ? 20 : 12)
  if (scaleAt + 4 > mdhd.end) return null
  const timescale = u32(bytes, scaleAt)
  const count = u32(bytes, stts.start + 4)
  let best = 0
  let bestCount = 0
  for (let i = 0; i < count && stts.start + 16 + i * 8 <= stts.end; i += 1) {
    const samples = u32(bytes, stts.start + 8 + i * 8)
    const delta = u32(bytes, stts.start + 12 + i * 8)
    if (samples > bestCount) {
      bestCount = samples
      best = delta
    }
  }
  const seconds = timescale > 0 ? best / timescale : 0
  return plausibleFrameDuration(seconds) ? seconds : null
}

// ---------------------------------------------------------------------------------------------
// AVI

/** The streams of an AVI file from its header list (`hdrl`): FourCC for video, format tag for sound. */
export function readAviStreams(bytes: Uint8Array): Track[] {
  const limit = Math.min(bytes.length, AVI_HEADER_LIMIT)
  if (limit < 12 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'AVI ') {
    return []
  }
  for (const chunk of riffChunks(bytes, 12, limit)) {
    if (chunk.type === 'LIST' && chunk.listType === 'hdrl') {
      const tracks: Track[] = []
      for (const list of riffChunks(bytes, chunk.start + 4, chunk.end)) {
        if (list.type === 'LIST' && list.listType === 'strl') {
          const track = readStreamList(bytes, list)
          if (track) tracks.push(track)
        }
      }
      return tracks
    }
  }
  return []
}

type Chunk = { type: string; listType: string; start: number; end: number }

function le16(bytes: Uint8Array, pos: number): number {
  return bytes[pos] | (bytes[pos + 1] << 8)
}

function le32(bytes: Uint8Array, pos: number): number {
  return (bytes[pos] | (bytes[pos + 1] << 8) | (bytes[pos + 2] << 16)) + bytes[pos + 3] * 2 ** 24
}

/** RIFF chunks between `start` and `end`; a chunk that runs past the end is clipped to it. */
function* riffChunks(bytes: Uint8Array, start: number, end: number): Generator<Chunk> {
  let pos = start
  while (pos + 8 <= end) {
    const size = le32(bytes, pos + 4)
    const dataStart = pos + 8
    const dataEnd = Math.min(end, dataStart + size)
    const type = fourcc(bytes, pos)
    yield { type, listType: type === 'LIST' && dataStart + 4 <= end ? fourcc(bytes, dataStart) : '', start: dataStart, end: dataEnd }
    pos = dataStart + size + (size & 1)
  }
}

function readStreamList(bytes: Uint8Array, list: Chunk): Track | null {
  let streamType = ''
  let handler = ''
  let format: Chunk | null = null
  for (const chunk of riffChunks(bytes, list.start + 4, list.end)) {
    if (chunk.type === 'strh' && chunk.end - chunk.start >= 8) {
      streamType = fourcc(bytes, chunk.start)
      handler = fourcc(bytes, chunk.start + 4)
    } else if (chunk.type === 'strf') {
      format = chunk
    }
  }
  if (streamType === 'vids') {
    const compression = format && format.end - format.start >= 20 ? fourcc(bytes, format.start + 16) : handler
    return { kind: 'video', codec: `fourcc:${compression.trim() || handler.trim()}` }
  }
  if (streamType === 'auds' && format && format.end - format.start >= 2) {
    let tag = le16(bytes, format.start)
    // WAVE_FORMAT_EXTENSIBLE: the real tag is the start of the SubFormat GUID.
    if (tag === 0xfffe && format.end - format.start >= 26) {
      tag = le16(bytes, format.start + 24)
    }
    return { kind: 'audio', codec: `wave:${tag}` }
  }
  return streamType ? { kind: 'other', codec: streamType } : null
}

// ---------------------------------------------------------------------------------------------
// Names

function plausibleFrameDuration(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds >= 1 / 1000 && seconds <= 1
}

const MATROSKA_VIDEO: Array<[string, string]> = [
  ['V_MPEG4/ISO/AVC', 'H.264'],
  ['V_MPEGH/ISO/HEVC', 'HEVC (H.265)'],
  ['V_MPEG4/ISO/', 'MPEG-4 Part 2'],
  ['V_MPEG4/MS/', 'MS MPEG-4'],
  ['V_MPEG1', 'MPEG-1'],
  ['V_MPEG2', 'MPEG-2'],
  ['V_VP8', 'VP8'],
  ['V_VP9', 'VP9'],
  ['V_AV1', 'AV1'],
  ['V_THEORA', 'Theora'],
  ['V_PRORES', 'ProRes'],
  ['V_MJPEG', 'Motion JPEG'],
  ['V_FFV1', 'FFV1'],
  ['V_REAL/', 'RealVideo'],
  ['V_UNCOMPRESSED', 'uncompressed video']
]

const MP4_VIDEO: Record<string, string> = {
  avc1: 'H.264',
  avc3: 'H.264',
  hvc1: 'HEVC (H.265)',
  hev1: 'HEVC (H.265)',
  vp08: 'VP8',
  vp09: 'VP9',
  av01: 'AV1',
  mp4v: 'MPEG-4 Part 2',
  s263: 'H.263',
  h263: 'H.263',
  mp1v: 'MPEG-1',
  mp2v: 'MPEG-2',
  m2v1: 'MPEG-2',
  apch: 'ProRes',
  apcn: 'ProRes',
  apcs: 'ProRes',
  apco: 'ProRes',
  ap4h: 'ProRes',
  ap4x: 'ProRes',
  jpeg: 'Motion JPEG',
  mjpa: 'Motion JPEG',
  mjpb: 'Motion JPEG',
  dvc: 'DV',
  dvcp: 'DV',
  dv5n: 'DV',
  dv5p: 'DV',
  dvh5: 'DV',
  dvh6: 'DV',
  dvhp: 'DV',
  dvhq: 'DV',
  cvid: 'Cinepak',
  SVQ1: 'Sorenson Video',
  SVQ3: 'Sorenson Video 3'
}

const FOURCC_VIDEO: Record<string, string> = {
  XVID: 'Xvid',
  DIVX: 'DivX',
  DX50: 'DivX 5',
  DIV3: 'DivX 3',
  MP4V: 'MPEG-4 Part 2',
  FMP4: 'MPEG-4 Part 2',
  H264: 'H.264',
  X264: 'H.264',
  AVC1: 'H.264',
  MJPG: 'Motion JPEG',
  WMV1: 'WMV 7',
  WMV2: 'WMV 8',
  WMV3: 'WMV 9',
  WVC1: 'VC-1',
  MPG1: 'MPEG-1',
  MPG2: 'MPEG-2'
}

/** A codec id from `Track.codec`, named for people: `V_MPEG2` → `MPEG-2`. */
export function videoCodecName(codec: string): string {
  if (codec.startsWith('fourcc:')) {
    const tag = codec.slice(7)
    return FOURCC_VIDEO[tag.toUpperCase()] ?? tag
  }
  const matroska = MATROSKA_VIDEO.find(([prefix]) => codec.startsWith(prefix))
  if (matroska) {
    return matroska[1]
  }
  return MP4_VIDEO[codec] ?? MP4_VIDEO[codec.trim()] ?? codec
}

/** Sound Chromium does not decode, by Matroska CodecID or MP4 sample entry; null when it plays. */
export function unplayableSoundName(codec: string): string | null {
  if (codec.startsWith('A_EAC3') || codec === 'ec-3') return 'E-AC3'
  if (codec.startsWith('A_AC3') || codec === 'ac-3') return 'AC3'
  if (codec.startsWith('A_DTS') || /^dts[chle]$/.test(codec)) return 'DTS'
  if (codec.startsWith('A_TRUEHD') || codec === 'mlpa') return 'TrueHD'
  return null
}

const WAVE_FORMATS: Record<number, string> = {
  0x0001: 'PCM',
  0x0002: 'MS ADPCM',
  0x0003: 'PCM (float)',
  0x0006: 'A-law (G.711)',
  0x0007: 'µ-law (G.711)',
  0x0011: 'IMA ADPCM',
  0x0031: 'GSM 6.10',
  0x0050: 'MP2',
  0x0055: 'MP3',
  0x00ff: 'AAC',
  0x0160: 'WMA',
  0x0161: 'WMA',
  0x0162: 'WMA Pro',
  0x0163: 'WMA Lossless',
  0x1610: 'AAC',
  0x2000: 'AC3',
  0x2001: 'DTS',
  0x674f: 'Vorbis',
  0x6750: 'Vorbis',
  0x6751: 'Vorbis',
  0xf1ac: 'FLAC'
}

/** An AVI sound format tag (`wave:353`), named for people: `WMA`; unknown tags read `0x1234`. */
export function soundFormatName(codec: string): string {
  const tag = Number(codec.replace(/^wave:/, ''))
  if (!Number.isInteger(tag)) return codec
  return WAVE_FORMATS[tag] ?? `0x${tag.toString(16).toUpperCase().padStart(4, '0')}`
}
