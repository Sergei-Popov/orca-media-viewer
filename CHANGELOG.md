# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). `scripts/release-plugin.sh` in the hub turns
`[Unreleased]` into the released version.

## [Unreleased]

### Changed

- Listing images and description: a fuchsia icon, and a cover and four screenshots in the hub's house style, rendered from a generated demo clip in a headless stage (`tools/listing.json`, `tools/make-listing-samples.sh`). The manifest's images carry only a path and an alt, and the description now starts with what the plugin is: a media player.

### Fixed

- File info no longer shows a made-up file name ("media.mkv"): Orca never tells an editor the file's name, so the overlay lists size, resolution, duration, frame rate and type.
- AVI files at 23.976, 29.97, 59.94, 12.5 or another fractional frame rate convert and play; they failed with "The AVI file could not be converted".
- File info shows the right frame rate: the AVI decoder's exact rate, otherwise a rate measured over at least a second of playback at 1× and named by the common rate it is (30, not 29.97, for a 30 fps MKV). It shows "—" until then, and audio files have no resolution or frame rate rows.
- Frame steps move exactly one frame on a freshly opened, paused clip, at 24, 25, 30 or 60 fps and with Matroska's millisecond timestamps: they use the container's frame duration or the AVI rate and step from the frame on screen, so the first step after pausing playback no longer repeats that frame.
- A video file whose video codec Orca's Chromium does not decode (MPEG-2, Xvid in MKV, ProRes) no longer passes for an audio file: it plays its sound with a notice that names the video codec.
- Sound that cannot play is no longer dropped silently: an MKV, WebM or MP4 whose sound is AC3, E-AC3, DTS or TrueHD (in MP4 and MOV, the enabled sound track, which Chromium plays even when a disabled AAC alternate follows), and an AVI with sound the decoder lacks (WMA, DTS, FLAC, G.711), plays the picture with a notice that names the sound codec. An AVI with only such sound names it in the error. When an AVI's sound is in a codec the decoder has (MP3, PCM, AAC, AC3, MP2, ADPCM) and still gives nothing, as a damaged stream does, the notice says the sound could not be decoded.
- WebM and Matroska without a duration (browser recordings, piped or unfinished captures) can be seeked: the player finds the duration when the file opens, and `End` and seeks stop a second before the end, where Chromium can stall for good on a seek into such a file.
- AVI conversion errors name the cause: a damaged file, not an unsupported codec, when the codec is built in; the frame size when it is too large for the video encoder; and an AVI from which nothing decodes is an error instead of an empty 0:00 player.
- SD AVI in Xvid, DivX, MJPEG and the other codecs that carry no colour description keeps its colours: the converted video is tagged BT.601 instead of BT.709, which oversaturated greens and reds. H.264 and MPEG-2 AVI, whose streams can describe their colours, convert as in 0.3.0, so SD H.264 tagged BT.709 keeps its colours too.
- The header reader has bounds: it reads at most 128 Matroska TrackEntries and visits at most 10,000 MP4 boxes per level and 100,000 in all, so a crafted file no longer holds up the tab for 0.1–0.3 s or takes about 100 MB.
- The decode error no longer says AVI does not play, and says that AC3, E-AC3, DTS and TrueHD sound does not play.
- The Russian UI writes sizes, seconds and speeds in Russian (`1,9 МБ`, `+5 с`, `0,5×`), and letter shortcuts work with a Russian keyboard layout.
- The README gives Orca's real size limits (50 MiB for `.mkv`, `.avi`, `.mka`, `.weba`; 64 MiB for `.mp4`, `.mov`, `.webm` and audio), names `wasm/` as LGPL-2.1-or-later, and runs `orca plugin types .` before the type check.

### Removed

- Full screen (the button, `F` and double-click): Orca denies full screen to plugin frames, so it never worked.

## [0.3.0] - 2026-11-14

### Added

- `.avi` opens in Media Player instead of "Binary file — cannot display". The tab converts it to MP4 offline when it opens (FFmpeg in WebAssembly decodes, the browser's WebCodecs encoders write H.264 or VP9 with Opus or AAC) and shows the progress. Video: Xvid, DivX 3/4/5, MPEG-4, H.264, H.263, MJPEG, MPEG-1/2; sound: MP3, MP2, AC3, AAC, PCM, ADPCM, surround mixed down to stereo. Unsupported codecs and damaged files get a clear message.

### Changed

- License is now `MIT AND LGPL-2.1-or-later`: the bundled FFmpeg decoder (`vendor/ffmpeg`) is LGPL; its source and build script are in `wasm/`.

## [0.2.0] - 2026-11-14

### Added

- File icon theme "Media Viewer" (Settings → Appearance → Icon theme): video and audio files get their own icons in tabs, the file tree, Quick Open and search, even when Orca's built-in player opens them. It maps only media files; other files show Orca's built-in icons while it is selected.
- Tabs opened in Media Player show a video or an audio icon instead of the plugin icon.

### Changed

- Media Player is split into video and audio editors (`media`, `media-audio`, `media-plus`, `media-plus-audio`) so each gets its tab icon.

## [0.1.1] - 2026-11-14

### Added

- Icon, cover and screenshots for the plugin page in Orca and on orca.dev.

### Changed

- File info shows "— (measured during playback)" for the frame rate until the clip has played, instead of a guessed "≈ 30 (unknown)".

## [0.1.0] - 2026-11-14

### Added

- Media Player for video and audio in Orca's editor tabs, opened from the file tree, chat file links or `orca file open`.
- Opens `.mkv`, `.mka` and `.weba` by default (Orca has no viewer for them).
- Offered in the tab's view toggle for `.mp4`, `.m4v`, `.mov`, `.webm`, `.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.oga`, `.flac` and `.opus`, keeping Orca's built-in player as the default.
- Controls: play/pause, seek, volume and mute, speed 0.25×–3×, repeat, frame stepping, fit / actual size, full screen.
- Save the current frame as PNG through Orca's save dialog.
- File info overlay: size, resolution, duration, measured frame rate, type.
- Audio cover in place of a black frame.
- Keyboard shortcuts, light and dark themes, English and Russian UI.
