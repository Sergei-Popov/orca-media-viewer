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
