# Media Viewer for Orca

![Media Player in an Orca tab](images/cover.png)

Video and audio in [Orca](https://orca.dev)'s editor tabs — opened from the file tree, a file
link in an agent chat, or `orca file open`, just like images.

| Files                                                        | What opens                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `.mkv`, `.mka`, `.weba`                                      | **Media Player** — Orca has no viewer for these and shows "Binary file — cannot display" without the plugin.                    |
| `.mp4`, `.m4v`, `.mov`, `.webm`, `.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.oga`, `.flac`, `.opus` | Orca's own basic player (any size) by default; switch the tab to **Media Player** with the view toggle at the top right of the tab. |

Media Player adds:

- speed from 0.25× to 3×, repeat, frame-by-frame stepping, fit / actual size, full screen;
- **save the current frame as PNG** through Orca's save dialog;
- file info: resolution, duration, measured frame rate, size, type;
- keyboard shortcuts, Orca's light and dark themes, English and Russian UI;
- a cover instead of a black frame for audio.

It is read-only and offline: no capabilities, no network, the file is never modified.

**Size limit.** Orca sends at most 64 MB to a plugin editor and shows its own notice for larger
files. For `.mp4`, `.mov`, `.webm` and audio, Orca's built-in player has no limit, so switch the
tab back to it.

## Keyboard

| Key                   | Action                              |
| --------------------- | ----------------------------------- |
| `Space` / `K`         | Play / pause                        |
| `←` `→`               | Back / forward 5 s (`Shift`: 1 s)   |
| `J` `L`               | Back / forward 10 s                 |
| `,` `.`               | Previous / next frame               |
| `0`–`9`               | Jump to 0 %–90 %                    |
| `Home` `End`          | Start / end                         |
| `<` `>` / `=`         | Slower / faster / normal speed      |
| `↑` `↓` / `M`         | Volume / mute                       |
| `R`                   | Repeat                              |
| `S`                   | Save frame as PNG                   |
| `Z`                   | Fit to window / actual size         |
| `I`                   | File info                           |
| `F`                   | Full screen                         |

## Formats

Playback uses the Chromium inside Orca. H.264, VP8, VP9 and AV1 video and AAC, MP3, Opus,
Vorbis, FLAC and PCM audio play everywhere; HEVC (H.265) plays where the OS has a hardware
decoder (macOS, recent Windows). ProRes, MPEG-2, DivX/Xvid and `.avi` do not play — convert
them with `ffmpeg -i in.avi -c:v libx264 -c:a aac out.mp4`.

## Install

From the catalog: Orca → Settings → Plugins → ⋯ → **Catalog sources…** → add
`https://github.com/Sergei-Popov/orca-plugin.git`, then install **Media Viewer**.

From source:

```sh
git clone https://github.com/Sergei-Popov/orca-media-viewer.git
orca plugin dev load ./orca-media-viewer   # prints the access it needs and an --approve fingerprint
```

## Develop

No build step: Orca transpiles the TypeScript in `src/` on load.

```sh
orca plugin dev watch . --check   # load, reload on save, stream logs
orca plugin test .                # unit tests (src/*.test.ts)
npx -p typescript tsc -p .        # type check
orca plugin validate .
orca plugin shot local.media-viewer --editor path/to/clip.mkv   # PNG of the editor
```

- `src/editor.ts` — the custom editor entry: bytes document → Blob → player.
- `src/player.ts` — the player UI; `src/styles.ts`, `src/icons.ts`, `src/i18n.ts`.
- `src/format.ts` — pure helpers (types, MIME, time, keys) with tests in `src/format.test.ts`.

Branches follow git-flow: `feature/*` from `develop`, releases through `release/x.y.z` into
`main`, tagged `vX.Y.Z`. Only the maintainers push and open pull requests.

---

**По-русски.** Видео и аудио во вкладках Orca — из дерева файлов, по ссылке из чата агента или
через `orca file open`, как картинки. `.mkv`, `.mka`, `.weba` открываются плеером сразу; для
`.mp4`, `.mov`, `.webm`, `.mp3`, `.flac` и других Orca по умолчанию показывает свой простой
плеер, а **Media Player** включается переключателем вида справа вверху вкладки. Скорость,
покадровая перемотка, повтор, сохранение кадра в PNG, сведения о файле, горячие клавиши,
светлая и тёмная темы. Лимит Orca для редакторов плагинов — 64 МБ.

## License

MIT © Sergei Popov
