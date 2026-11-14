// UI strings in English and Russian; Orca's UI language picks one (`orca.locale`).

const en = {
  play: 'Play (Space)',
  pause: 'Pause (Space)',
  mute: 'Mute (M)',
  unmute: 'Unmute (M)',
  volume: 'Volume (↑ ↓)',
  speed: 'Speed (< >)',
  loop: 'Repeat (R)',
  frameBack: 'Previous frame (,)',
  frameForward: 'Next frame (.)',
  snapshot: 'Save frame as PNG (S)',
  fit: 'Fit to window / actual size (Z)',
  fullscreen: 'Full screen (F)',
  info: 'File info (I)',
  seek: 'Position',
  loading: 'Loading video…',
  infoName: 'File',
  infoSize: 'Size',
  infoResolution: 'Resolution',
  infoDuration: 'Duration',
  infoFps: 'Frame rate',
  infoType: 'Type',
  unknown: 'unknown',
  errorTitle: 'This video cannot be played',
  errorDecode:
    'The codec is not supported by Orca’s built-in Chromium. H.264, VP8/VP9 and AV1 play everywhere; HEVC (H.265) needs hardware support; ProRes, MPEG-2, DivX and AVI do not play.',
  errorNetwork: 'The file could not be read.',
  errorText: 'Orca sent this file as text; the video viewer needs its raw bytes.',
  errorGeneric: 'Playback failed.',
  snapshotSaved: 'Frame saved',
  snapshotFailed: 'Could not save the frame',
  panelOpen: 'Open video…',
  panelDrop: 'Drop video files here or click “Open video…”. Any size works: the file is read from disk, not loaded into memory.',
  panelHint: 'Videos up to 64 MB also open straight from the file tree.',
  panelRemove: 'Remove from list',
  panelClear: 'Clear list',
  panelNotVideo: 'Not a video file',
  readOnly: 'read-only'
}

export type Strings = typeof en

const ru: Strings = {
  play: 'Воспроизвести (Пробел)',
  pause: 'Пауза (Пробел)',
  mute: 'Выключить звук (M)',
  unmute: 'Включить звук (M)',
  volume: 'Громкость (↑ ↓)',
  speed: 'Скорость (< >)',
  loop: 'Повтор (R)',
  frameBack: 'Предыдущий кадр (,)',
  frameForward: 'Следующий кадр (.)',
  snapshot: 'Сохранить кадр в PNG (S)',
  fit: 'Вписать в окно / исходный размер (Z)',
  fullscreen: 'Во весь экран (F)',
  info: 'Сведения о файле (I)',
  seek: 'Позиция',
  loading: 'Загрузка видео…',
  infoName: 'Файл',
  infoSize: 'Размер',
  infoResolution: 'Разрешение',
  infoDuration: 'Длительность',
  infoFps: 'Частота кадров',
  infoType: 'Тип',
  unknown: 'неизвестно',
  errorTitle: 'Это видео не воспроизводится',
  errorDecode:
    'Кодек не поддерживается встроенным в Orca Chromium. H.264, VP8/VP9 и AV1 работают везде; HEVC (H.265) — только с аппаратной поддержкой; ProRes, MPEG-2, DivX и AVI не воспроизводятся.',
  errorNetwork: 'Не удалось прочитать файл.',
  errorText: 'Orca передала файл как текст, а просмотрщику нужны исходные байты.',
  errorGeneric: 'Ошибка воспроизведения.',
  snapshotSaved: 'Кадр сохранён',
  snapshotFailed: 'Не удалось сохранить кадр',
  panelOpen: 'Открыть видео…',
  panelDrop:
    'Перетащите видеофайлы сюда или нажмите «Открыть видео…». Размер не ограничен: файл читается с диска, а не загружается в память.',
  panelHint: 'Видео до 64 МБ открываются и прямо из дерева файлов.',
  panelRemove: 'Убрать из списка',
  panelClear: 'Очистить список',
  panelNotVideo: 'Это не видеофайл',
  readOnly: 'только чтение'
}

/** Strings for a BCP-47 tag: Russian for `ru*`, English otherwise. */
export function stringsFor(locale: string | undefined): Strings {
  return (locale ?? '').toLowerCase().startsWith('ru') ? ru : en
}
