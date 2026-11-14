// 24×24 stroke icons, drawn for this plugin in the style of Orca's own line icons.

const paths = {
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  muted: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  loop: '<path d="M17 2.5l3 3-3 3"/><path d="M4 11.5v-2a4 4 0 0 1 4-4h12"/><path d="M7 21.5l-3-3 3-3"/><path d="M20 12.5v2a4 4 0 0 1-4 4H4"/>',
  frameBack: '<path d="M18 5.5v13l-9-6.5z"/><path d="M6 5.5v13"/>',
  frameForward: '<path d="M6 5.5v13l9-6.5z"/><path d="M18 5.5v13"/>',
  camera:
    '<path d="M4 8.5h3l1.5-2.5h7L17 8.5h3v10H4z"/><circle cx="12" cy="13" r="3.2"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  actual: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M9 10v5M14 10v5M11.5 11.2v.1M11.5 13.8v.1"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  exitFullscreen: '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  film: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4"/>'
} as const

export type IconName = keyof typeof paths

/** An inline SVG for `name`, sized by the surrounding font (1.25em by default). */
export function icon(name: IconName): string {
  return (
    `<svg class="vv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`
  )
}
