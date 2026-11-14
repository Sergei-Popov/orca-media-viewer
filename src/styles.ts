// The page's CSS, built on the `--orca-*` theme variables so it follows Orca's light and dark
// themes; Orca updates the variables in place and toggles `light`/`dark` on <html>.

export const css = String.raw`
:root {
  --bg: var(--orca-background, #ffffff);
  --fg: var(--orca-foreground, #0a0a0a);
  --card: var(--orca-card, #ffffff);
  --muted: var(--orca-muted, #f5f5f5);
  --muted-fg: var(--orca-muted-foreground, #737373);
  --accent: var(--orca-accent, #f5f5f5);
  --accent-fg: var(--orca-accent-foreground, #171717);
  --border: var(--orca-border, #e5e5e5);
  --primary: var(--orca-primary, #171717);
  --primary-fg: var(--orca-primary-foreground, #fafafa);
  --ring: var(--orca-ring, #a3a3a3);
  --destructive: var(--orca-destructive, #dc2626);
  --popover: var(--orca-popover, #ffffff);
  --popover-fg: var(--orca-popover-foreground, #0a0a0a);
  --radius: var(--orca-radius, 6px);
  --stage: #000;
  --ui-font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono-font: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light;
}
:root.dark {
  --bg: var(--orca-background, #0a0a0a);
  --fg: var(--orca-foreground, #fafafa);
  --card: var(--orca-card, #0a0a0a);
  --muted: var(--orca-muted, #262626);
  --muted-fg: var(--orca-muted-foreground, #a3a3a3);
  --accent: var(--orca-accent, #262626);
  --accent-fg: var(--orca-accent-foreground, #fafafa);
  --border: var(--orca-border, #2e2e2e);
  --primary: var(--orca-primary, #fafafa);
  --primary-fg: var(--orca-primary-foreground, #171717);
  --ring: var(--orca-ring, #737373);
  --destructive: var(--orca-destructive, #f87171);
  --popover: var(--orca-popover, #171717);
  --popover-fg: var(--orca-popover-foreground, #fafafa);
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg);
  color: var(--fg);
  font: 12px/1.4 var(--ui-font);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}
button, select, input { font: inherit; color: inherit; }
.vv-icon { width: 1.25em; height: 1.25em; display: block; flex: none; }

/* The player: a stage that holds the video and its overlays, and a control bar under it. */
.vv-player { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); }
.vv-player:fullscreen { background: var(--stage); }
.vv-stage {
  position: relative; flex: 1; min-height: 0; overflow: hidden;
  background: var(--stage); display: flex; align-items: center; justify-content: center;
  outline: none;
}
.vv-stage.actual { overflow: auto; align-items: safe center; justify-content: safe center; }
.vv-video { display: block; width: 100%; height: 100%; object-fit: contain; background: var(--stage); }
.vv-stage.actual .vv-video { width: auto; height: auto; max-width: none; max-height: none; flex: none; }
.vv-stage.empty .vv-video { visibility: hidden; }

.vv-flash {
  position: absolute; left: 50%; top: 50%; width: 64px; height: 64px; margin: -32px 0 0 -32px;
  border-radius: 50%; background: rgba(0, 0, 0, 0.55); color: #fff; display: flex;
  align-items: center; justify-content: center; font-size: 28px; opacity: 0; pointer-events: none;
  transition: opacity 0.35s ease, transform 0.35s ease; transform: scale(0.85);
}
.vv-flash.show { opacity: 1; transform: scale(1); transition: none; }
.vv-badge {
  position: absolute; top: 10px; right: 10px; padding: 3px 8px; border-radius: 999px;
  background: rgba(0, 0, 0, 0.6); color: #fff; font: 600 12px var(--ui-font);
  opacity: 0; pointer-events: none; transition: opacity 0.4s ease;
}
.vv-badge.show { opacity: 1; transition: none; }
.vv-message {
  position: absolute; inset: 0; display: none; flex-direction: column; align-items: center;
  justify-content: center; gap: 8px; padding: 24px; text-align: center; color: #e5e5e5;
  background: var(--stage);
}
.vv-message.show { display: flex; }
.vv-message h2 { margin: 0; font-size: 14px; font-weight: 600; color: #fff; }
.vv-message p { margin: 0; max-width: 520px; color: #a3a3a3; }
.vv-message .vv-icon { width: 36px; height: 36px; color: #737373; }
.vv-message.error .vv-icon { color: #f87171; }

.vv-info {
  position: absolute; top: 10px; left: 10px; display: none; padding: 10px 12px;
  border-radius: var(--radius); background: rgba(10, 10, 10, 0.78); color: #f5f5f5;
  font: 12px/1.6 var(--ui-font); max-width: calc(100% - 20px); backdrop-filter: blur(6px);
}
.vv-info.show { display: grid; grid-template-columns: auto 1fr; column-gap: 12px; }
.vv-info dt { color: #a3a3a3; }
.vv-info dd { margin: 0; font-family: var(--mono-font); overflow-wrap: anywhere; }

.vv-bar {
  flex: none; display: flex; flex-direction: column; gap: 4px; padding: 6px 10px 8px;
  border-top: 1px solid var(--border); background: var(--card);
}
.vv-player:fullscreen .vv-bar { border-top-color: transparent; }
.vv-seek-row { display: flex; align-items: center; gap: 8px; }
.vv-time { font: 11px var(--mono-font); color: var(--muted-fg); white-space: nowrap; min-width: 0; }
.vv-controls { display: flex; align-items: center; gap: 2px; min-width: 0; }
.vv-spacer { flex: 1; min-width: 4px; }
.vv-btn {
  display: inline-flex; align-items: center; justify-content: center; height: 28px; min-width: 28px;
  padding: 0 6px; border: 0; border-radius: var(--radius); background: transparent; color: var(--fg);
  cursor: pointer; flex: none;
}
.vv-btn:hover { background: var(--accent); color: var(--accent-fg); }
.vv-btn:focus-visible, .vv-select:focus-visible, .vv-range:focus-visible {
  outline: 2px solid var(--ring); outline-offset: 1px;
}
.vv-btn[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); }
.vv-btn:disabled { opacity: 0.4; cursor: default; background: transparent; }
.vv-btn.primary { background: var(--primary); color: var(--primary-fg); gap: 6px; padding: 0 10px; }
.vv-btn.primary:hover { opacity: 0.9; background: var(--primary); color: var(--primary-fg); }
.vv-select {
  height: 26px; padding: 0 4px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg); cursor: pointer; flex: none;
}

/* Range inputs drawn from the theme: a thin track with a filled part and a round thumb. */
.vv-range {
  --fill: 0%;
  -webkit-appearance: none; appearance: none; height: 16px; margin: 0; background: transparent;
  cursor: pointer; min-width: 0;
}
.vv-range::-webkit-slider-runnable-track {
  height: 4px; border-radius: 2px;
  background: linear-gradient(to right, var(--primary) var(--fill), var(--muted) var(--fill));
}
.vv-range::-webkit-slider-thumb {
  -webkit-appearance: none; width: 12px; height: 12px; margin-top: -4px; border-radius: 50%;
  background: var(--primary); border: 2px solid var(--card);
}
.vv-range.seek { flex: 1; }
.vv-range.volume { width: 72px; flex: none; }

/* Narrow players (the sidebar panel) drop the less used controls. */
@container player (max-width: 420px) {
  .vv-optional { display: none; }
  .vv-range.volume { width: 48px; }
}
.vv-player { container: player / inline-size; }

/* The panel around the player: a toolbar, a drop zone and the list of opened files. */
.vv-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.vv-panel-head {
  flex: none; display: flex; align-items: center; gap: 6px; padding: 8px;
  border-bottom: 1px solid var(--border);
}
.vv-panel-head .vv-spacer { flex: 1; }
.vv-drop {
  margin: 8px; padding: 18px 14px; border: 1px dashed var(--border); border-radius: var(--radius);
  color: var(--muted-fg); text-align: center; display: flex; flex-direction: column; gap: 6px;
  align-items: center;
}
.vv-drop .vv-icon { width: 28px; height: 28px; }
.vv-panel.dragging .vv-drop, .vv-panel.dragging .vv-panel-player { outline: 2px dashed var(--ring); outline-offset: -4px; }
.vv-panel-player { flex: 1 1 60%; min-height: 160px; display: none; }
.vv-panel.has-video .vv-panel-player { display: block; }
.vv-panel.has-video .vv-drop { display: none; }
.vv-list { flex: 0 1 auto; max-height: 40%; overflow: auto; margin: 0; padding: 4px; list-style: none; border-top: 1px solid var(--border); }
.vv-list:empty { display: none; }
.vv-item {
  display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: var(--radius);
  cursor: pointer;
}
.vv-item:hover { background: var(--accent); color: var(--accent-fg); }
.vv-item.current { background: var(--accent); color: var(--accent-fg); font-weight: 600; }
.vv-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vv-item-size { color: var(--muted-fg); font: 11px var(--mono-font); flex: none; }
.vv-item .vv-btn { height: 22px; min-width: 22px; opacity: 0.6; }
.vv-item .vv-btn:hover { opacity: 1; }
.vv-toast {
  position: fixed; bottom: 64px; left: 50%; transform: translateX(-50%); padding: 6px 12px;
  border-radius: var(--radius); background: var(--popover); color: var(--popover-fg);
  border: 1px solid var(--border); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  opacity: 0; pointer-events: none; transition: opacity 0.3s ease; white-space: nowrap;
}
.vv-toast.show { opacity: 1; transition: none; }
.vv-hidden { display: none !important; }
`

/** Adds the stylesheet once. */
export function installStyles(doc: Document = document): void {
  if (doc.getElementById('vv-styles')) {
    return
  }
  const style = doc.createElement('style')
  style.id = 'vv-styles'
  style.textContent = css
  doc.head.append(style)
}
