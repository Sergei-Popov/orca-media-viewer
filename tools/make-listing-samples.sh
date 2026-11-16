#!/bin/sh
# Builds the listing demo clips into .orca/listing/samples/ (git-ignored): the 12 s scene that
# tools/make-listing-clip.py ray-traces, encoded as
#   sunset-orbit.mkv  H.264 + Opus
#   sunset-orbit.mp4  H.264 + AAC
#   sunset-orbit.avi  MPEG-4 Part 2 tagged XVID + AC3, looped to 60 s
# Every soundtrack is digital silence: the clips never make a sound, even when played.
#
#   tools/make-listing-samples.sh
#
# Needs ffmpeg with libx264, libopus and the native mpeg4, aac and ac3 encoders (FFMPEG=… to pick
# one), and Python 3 with numpy (PYTHON=…). The render takes a few minutes on many cores; to run
# it on another machine, set RENDER_SSH=<ssh host> and, if needed, RENDER_PYTHON to the command
# that runs Python with numpy there (for example "uv run -q --with numpy python3").
set -eu
cd "$(dirname "$0")/.."
out=.orca/listing/samples
FFMPEG=${FFMPEG:-ffmpeg}
mkdir -p "$out"

frames() {
  if [ -n "${RENDER_SSH:-}" ]; then
    ssh "$RENDER_SSH" "cd /tmp && ${RENDER_PYTHON:-python3} - 288 1280 720 24" < tools/make-listing-clip.py
  else
    "${PYTHON:-python3}" tools/make-listing-clip.py 288 1280 720 24
  fi
}

silence='anullsrc=channel_layout=stereo:sample_rate=48000'
frames | "$FFMPEG" -hide_banner -loglevel warning -y \
  -f rawvideo -pix_fmt rgb24 -s 1280x720 -r 24 -i - \
  -f lavfi -t 12 -i "$silence" \
  -map 0:v -map 1:a -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -g 48 \
    -c:a libopus -b:a 64k -shortest "$out/sunset-orbit.mkv" \
  -map 0:v -map 1:a -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -g 48 \
    -c:a aac -b:a 96k -movflags +faststart -shortest "$out/sunset-orbit.mp4" \
  -map 0:v -map 1:a -c:v mpeg4 -vtag XVID -q:v 3 -g 48 -pix_fmt yuv420p \
    -c:a ac3 -b:a 192k -shortest "$out/sunset-orbit-12s.avi"

# Five times round: a 60 s AVI, as long as a short screen recording.
"$FFMPEG" -hide_banner -loglevel warning -y -stream_loop 4 -i "$out/sunset-orbit-12s.avi" \
  -c copy "$out/sunset-orbit.avi"
rm -f "$out/sunset-orbit-12s.avi"
ls -l "$out"
