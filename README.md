# Video Viewer for Orca

Watch video files without leaving [Orca](https://orca.dev).

- **From the file tree.** Click an `.mp4`, `.m4v`, `.webm`, `.mov` or `.mkv` file and it plays in
  an editor tab (files up to 64 MB, Orca's limit for custom editors).
- **Any size from the panel.** Open the **Video Player** panel in the right sidebar, then click
  **Open video…** or drop files on it. The file is streamed from disk, never copied into memory,
  so multi-gigabyte recordings work. Several files form a playlist that plays in order.
- Speed from 0.25× to 3×, repeat, frame-by-frame stepping, fit / actual size, full screen.
- **Save the current frame as PNG** through Orca's save dialog.
- File info: resolution, duration, measured frame rate, size, type.
- Follows Orca's light and dark themes; English and Russian UI.
- Read-only and offline: no capabilities, no network, the file is never modified.

## Keyboard

| Key                   | Action                          |
| --------------------- | ------------------------------- |
| `Space` / `K`         | Play / pause                    |
| `←` `→`               | Back / forward 5 s (`Shift`: 1 s) |
| `J` `L`               | Back / forward 10 s             |
| `,` `.`               | Previous / next frame           |
| `0`–`9`               | Jump to 0 %–90 %                |
| `Home` `End`          | Start / end                     |
| `<` `>` / `=`         | Slower / faster / normal speed  |
| `↑` `↓` / `M`         | Volume / mute                   |
| `R`                   | Repeat                          |
| `S`                   | Save frame as PNG               |
| `Z`                   | Fit to window / actual size     |
| `I`                   | File info                       |
| `F`                   | Full screen                     |

## Formats

Playback uses the Chromium inside Orca. H.264, VP8, VP9 and AV1 play everywhere; HEVC (H.265)
plays where the OS has a hardware decoder (macOS, recent Windows). ProRes, MPEG-2, DivX/Xvid and
`.avi` containers do not play — convert them with `ffmpeg -i in.mov -c:v libx264 -c:a aac out.mp4`.

## Install

From the catalog: Orca → Settings → Plugins → ⋯ → **Catalog sources…** → add
`https://github.com/Sergei-Popov/orca-plugin.git`, then install **Video Viewer**.

From source:

```sh
git clone https://github.com/Sergei-Popov/orca-video-viewer.git
orca plugin dev load ./orca-video-viewer   # prints the access it needs and an --approve fingerprint
```

## Develop

No build step: Orca transpiles the TypeScript in `src/` on load.

```sh
orca plugin dev watch . --check   # load, reload on save, stream logs
orca plugin test .                # unit tests (src/*.test.ts)
npx -p typescript tsc -p .        # type check
orca plugin validate .
```

- `src/editor.ts` — the custom editor entry (bytes document → Blob → player).
- `src/panel.ts` — the sidebar panel entry (file picker, drag and drop, playlist).
- `src/player.ts` — the shared player UI; `src/format.ts` — pure helpers with tests.

Branches follow git-flow: work on `feature/*` from `develop`, releases go through
`release/x.y.z` into `main` and are tagged `vX.Y.Z`.

---

**По-русски.** Просмотр видео внутри Orca: клик по видеофайлу в дереве файлов (до 64 МБ) или
панель **Video Player** для файлов любого размера и плейлистов. Скорость, покадровая перемотка,
повтор, сохранение кадра в PNG, сведения о файле, горячие клавиши, светлая и тёмная темы.

## License

MIT © Sergei Popov
