# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). `scripts/release-plugin.sh` in the hub turns
`[Unreleased]` into the released version.

## [Unreleased]

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
