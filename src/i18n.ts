// UI strings of the media player in English and Russian; Orca's UI language picks one (`orca.locale`).

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
  loading: 'Loading…',
  audio: 'Audio',
  infoSize: 'Size',
  infoResolution: 'Resolution',
  infoDuration: 'Duration',
  infoFps: 'Frame rate',
  infoFpsPending: 'measured during playback',
  aviConverting: 'Preparing AVI for playback…',
  aviCodec: 'This AVI uses the {codec} video codec, which Media Player cannot decode.',
  aviEncoder: 'Orca cannot re-encode video here: WebCodecs is not available.',
  aviNotAvi: 'The file is damaged or is not an AVI file.',
  aviNoStreams: 'The AVI file has no video or sound.',
  aviMemory: 'Not enough memory to convert this AVI file.',
  aviFailed: 'The AVI file could not be converted.',
  infoType: 'Type',
  unknown: 'unknown',
  errorTitle: 'This file cannot be played',
  errorDecode:
    'The codec is not supported by Orca’s built-in Chromium. H.264, VP8/VP9 and AV1 play everywhere; HEVC (H.265) needs hardware support; ProRes, MPEG-2, DivX and AVI do not play.',
  errorNetwork: 'The file could not be read.',
  errorText: 'Orca sent this file as text; the video viewer needs its raw bytes.',
  errorGeneric: 'Playback failed.',
  snapshotSaved: 'Frame saved',
  snapshotFailed: 'Could not save the frame',
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
  loading: 'Загрузка…',
  audio: 'Аудио',
  infoSize: 'Размер',
  infoResolution: 'Разрешение',
  infoDuration: 'Длительность',
  infoFps: 'Частота кадров',
  infoFpsPending: 'измеряется при воспроизведении',
  aviConverting: 'Подготовка AVI к воспроизведению…',
  aviCodec: 'В этом AVI видео в кодеке {codec}, его Media Player не декодирует.',
  aviEncoder: 'Orca не может перекодировать видео: WebCodecs недоступен.',
  aviNotAvi: 'Файл повреждён или это не AVI.',
  aviNoStreams: 'В файле AVI нет ни видео, ни звука.',
  aviMemory: 'Не хватает памяти, чтобы преобразовать этот AVI.',
  aviFailed: 'Не удалось преобразовать файл AVI.',
  infoType: 'Тип',
  unknown: 'неизвестно',
  errorTitle: 'Этот файл не воспроизводится',
  errorDecode:
    'Кодек не поддерживается встроенным в Orca Chromium. H.264, VP8/VP9 и AV1 работают везде; HEVC (H.265) — только с аппаратной поддержкой; ProRes, MPEG-2, DivX и AVI не воспроизводятся.',
  errorNetwork: 'Не удалось прочитать файл.',
  errorText: 'Orca передала файл как текст, а просмотрщику нужны исходные байты.',
  errorGeneric: 'Ошибка воспроизведения.',
  snapshotSaved: 'Кадр сохранён',
  snapshotFailed: 'Не удалось сохранить кадр',
  readOnly: 'только чтение'
}

/** Strings for a BCP-47 tag: Russian for `ru*`, English otherwise. */
export function stringsFor(locale: string | undefined): Strings {
  return (locale ?? '').toLowerCase().startsWith('ru') ? ru : en
}
