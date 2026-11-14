#!/usr/bin/env bash
# Builds vendor/ffmpeg/avi-decoder.{mjs,wasm}: FFmpeg's AVI demuxer and the decoders AVI files
# use, plus wasm/avi.c, compiled to WebAssembly with Emscripten.
#
#   wasm/build.sh                 # in Docker (emscripten/emsdk), from the plugin folder
#   docker --context pc ...       # any Docker host works; the script copies the result back
#
# Inside the container it runs `wasm/build.sh --inside`. The result is LGPL-2.1-or-later
# (FFmpeg built without GPL parts); vendor/ffmpeg/LICENSE carries the license text.
set -euo pipefail

FFMPEG_VERSION=7.1.1
EMSDK_IMAGE=emscripten/emsdk:3.1.74

DECODERS=(
  # video
  mpeg4 msmpeg4v1 msmpeg4v2 msmpeg4v3 h263 h264 mjpeg mpeg1video mpeg2video rawvideo
  # audio
  mp3float mp2float mp3 mp2 ac3 aac pcm_s16le pcm_u8 pcm_s24le pcm_s32le pcm_f32le
  adpcm_ima_wav adpcm_ms
)
PARSERS=(mpeg4video h263 h264 mjpeg mpegvideo mpegaudio ac3 aac)

inside() {
  local work=/src/.wasm-build prefix=/src/.wasm-build/prefix out=/src/vendor/ffmpeg
  mkdir -p "$work" "$prefix" "$out"
  cd "$work"
  if [[ ! -d "ffmpeg-$FFMPEG_VERSION" ]]; then
    curl -fsSL "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" | tar xJ
  fi
  cd "ffmpeg-$FFMPEG_VERSION"
  local stamp="$FFMPEG_VERSION ${DECODERS[*]} ${PARSERS[*]}"
  if [[ ! -f "$prefix/lib/libavcodec.a" || "$(cat "$prefix/.stamp" 2>/dev/null)" != "$stamp" ]]; then
    build_ffmpeg "$prefix"
    echo "$stamp" > "$prefix/.stamp"
  fi
  link "$prefix" "$out"
}

build_ffmpeg() {
  local prefix="$1"
  local enable=()
  for d in "${DECODERS[@]}"; do enable+=("--enable-decoder=$d"); done
  for p in "${PARSERS[@]}"; do enable+=("--enable-parser=$p"); done
  emconfigure ./configure \
    --prefix="$prefix" --target-os=none --arch=x86_32 --enable-cross-compile \
    --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=emnm \
    --disable-asm --disable-stripping --disable-runtime-cpudetect \
    --disable-autodetect --disable-everything --disable-programs --disable-doc --disable-debug \
    --disable-network --disable-pthreads --disable-w32threads --disable-os2threads \
    --disable-avdevice --disable-avfilter --disable-postproc \
    --enable-avformat --enable-avcodec --enable-swscale --enable-swresample --enable-small \
    --enable-demuxer=avi "${enable[@]}" \
    --extra-cflags="-Oz -msimd128" --extra-ldflags="-Oz"
  emmake make -j"$(nproc)"
  emmake make install
}

link() {
  local prefix="$1" out="$2"
  emcc -Oz -msimd128 /src/wasm/avi.c -I"$prefix/include" \
    "$prefix/lib/libavformat.a" "$prefix/lib/libavcodec.a" "$prefix/lib/libswscale.a" \
    "$prefix/lib/libswresample.a" "$prefix/lib/libavutil.a" \
    -o "$out/avi-decoder.mjs" \
    --no-entry \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createAviDecoder \
    -sENVIRONMENT=worker \
    -sFILESYSTEM=0 -sDYNAMIC_EXECUTION=0 \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=2147483648 \
    -sSTACK_SIZE=1048576 \
    -sEXPORTED_FUNCTIONS=_avi_open,_avi_close,_avi_next,_avi_alloc,_avi_free,_avi_has_video,_avi_has_audio,_avi_width,_avi_height,_avi_fps,_avi_channels,_avi_sample_rate,_avi_duration,_avi_video_codec,_avi_audio_codec,_avi_unsupported_codec,_avi_video_data,_avi_video_size,_avi_video_pts,_avi_audio_data,_avi_audio_frames,_avi_audio_pts,_avi_position \
    -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF32,UTF8ToString
  cp "/src/.wasm-build/ffmpeg-$FFMPEG_VERSION/COPYING.LGPLv2.1" "$out/LICENSE"
  echo "FFmpeg $FFMPEG_VERSION, $EMSDK_IMAGE, decoders: ${DECODERS[*]}" > "$out/BUILD-INFO"
  ls -la "$out"
}

if [[ "${1:-}" == "--inside" ]]; then
  inside
  exit 0
fi

here="$(cd "$(dirname "$0")/.." && pwd)"
docker run --rm -v "$here:/src" -w /src "$EMSDK_IMAGE" bash /src/wasm/build.sh --inside
