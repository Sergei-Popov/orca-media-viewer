#!/bin/sh
# Rasterizes the plugin icon SVG to a 256×256 PNG with headless Chrome (macOS path; set CHROME
# elsewhere), then re-encodes it losslessly with the hub's pinned sharp (zlib level 9, no adaptive
# filtering): the same pixels in fewer bytes. Outside the hub, set SHARP_DIR to a folder with sharp
# in its node_modules, or the PNG stays as Chrome wrote it. The tab icons (icons/*.png) are kept.
set -eu
cd "$(dirname "$0")/.."
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
SHARP_DIR=${SHARP_DIR:-"$PWD/../../scripts/lib/listing"}
for svg in images/icon.svg; do
  png="${svg%.svg}.png"
  tmp=$(mktemp -d)
  printf '<html><body style="margin:0;background:transparent"><img src="file://%s" width="256" height="256" style="display:block"></body></html>' \
    "$PWD/$svg" > "$tmp/page.html"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size=256,256 --screenshot="$PWD/$png" "file://$tmp/page.html" >/dev/null 2>&1
  rm -rf "$tmp"
  if [ -d "$SHARP_DIR/node_modules/sharp" ]; then
    node -e '
      const [dir, file] = process.argv.slice(1)
      const sharp = require(require.resolve("sharp", { paths: [dir] }))
      sharp(file).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer()
        .then((buffer) => require("fs").writeFileSync(file, buffer))
    ' "$SHARP_DIR" "$PWD/$png"
  else
    echo "note: no sharp in $SHARP_DIR; $png is left as Chrome wrote it" >&2
  fi
  echo "$png $(wc -c < "$png" | tr -d ' ') bytes"
done
